# Artwork generation container

This is an internal Cloudflare Container origin for the Worker. It does not expose the existing printer server's HTTP handler, NFC/session state, CUPS commands, or the local job database. Keep container ingress private; the public Worker owns authorization, quotas, queueing, R2 persistence, and client status.

## Build and run

Run from the `seed-universe` directory:

```sh
docker build -f cloudflare-backend/container/Dockerfile -t between-renderer .
docker run --rm -p 127.0.0.1:8080:8080 between-renderer
```

`Dockerfile.dockerignore` is a Dockerfile-specific allowlist for this build context. It excludes real `printer/jobs`, every SQLite database, secrets, user artifacts, and unrelated site files. The Dockerfile also explicitly copies only six renderer source/config files and two adapter files. Do not replace this with `COPY .`.

The image runs as UID 10001. Runtime artifacts live in `/tmp/between-artworks`; no volume or durable user database is required. Exact dependency versions are in `requirements.txt`. The unchanged Python visual algorithm is copied from `printer/server.py`, `garden_style.py`, `rarity.py`, and `story.py` during the image build.

## API contract

Every JSON response has `Cache-Control: no-store`. Port defaults to 8080.

| Method / route | Result |
|---|---|
| `GET /health` | 200 `{ok:true,busy,generator:"local_garden",max_concurrent_renders:1,render_timeout_seconds:120}`; 503 if required source/dependencies are missing. Busy alone is not unhealthy. |
| `POST /render` | Synchronously return the original completed job manifest as JSON. Exactly one render per instance. |
| `GET /files/:id/artwork.png` | Stream the original PNG. |
| `GET /files/:id/artwork.webp` | Stream the compact preview. |
| `GET /files/:id/artwork.pdf` | Stream the original print document. |
| `GET /files/:id/particles.json` | Stream original particle positions. |
| `DELETE /files/:id` | Remove this job's temporary inputs, private module copy, and generated files. Idempotent 200. Returns 409 during a render; retry after it finishes. |

Send the POST as a JSON string body so fetch supplies `Content-Length`; chunked input is rejected. Maximum body is 4096 bytes.

```json
{
  "id": "SG-20260913-0001-00002328",
  "cards": [1, 2],
  "seed": 9000,
  "request_id": "worker-assigned-idempotency-key"
}
```

The Worker assigns `id`, matching `SG-[0-9]{8}-[0-9]+-[A-F0-9]{8}`. `cards` must be two different integers in 1–12. `seed` is an unsigned 32-bit integer; `request_id` is a nonempty string up to 128 characters. Extra fields are rejected. Card order is preserved in the input/manifest. The adapter does not calculate new randomness or overwrite these fields.

Success returns the existing manifest structure: `id`, `params`, `rarity`, `story`, `generator`, `style_version`, `style_scale`, `request_id`, timestamps, `status:"ready"`, `image`, `pdf`, `particles`, `particle_count`, and `print_status:"not_submitted"`. The original path fields remain `/printer/jobs/:id/...`; the Worker should use `/files/:id/:filename` to retrieve all four outputs, upload them to R2, then rewrite public URLs in its stored job record. Do not present `print_status` as proof of physical printing.

| Condition | HTTP / code | Worker behavior |
|---|---|---|
| Already rendering | 429 `busy`, `Retry-After: 3` | Queue/retry on this or another instance. |
| Same completed ID and exact input | 200, previous manifest | Safe recovery from a lost POST response; files remain until DELETE/container eviction. |
| Same completed ID with changed input | 409 `id_conflict` | Keep job identity tied to its original inputs. |
| Invalid fields/body | 400, or 413 for oversized body | Reject without starting computation. |
| Missing renderer dependencies | 503 `not_ready` | Retry another healthy instance. |
| Render exceeds timeout | 504 `render_timeout` | Child process is killed and temporary files removed; capacity is released. |
| Generator fails/incomplete outputs | 500 `render_failed` | Temporary files removed; capacity is released. |
| Unknown/unready file | 404 `not_found` | No partial artifact is exposed. |

`RENDER_TIMEOUT_SECONDS` may reduce the default 120-second hard process limit but cannot exceed it. Give the Worker request a slightly longer deadline for connection/startup/manifest transfer. Do not use an upstream proxy with a 25-second timeout for `/render`.

The adapter copies the renderer source into each private job workspace before importing it. This prevents `server.py`'s import-time empty SQLite initialization from touching the shared source or any local database. `generate()`, `params()`, and the visual renderer are reused unchanged; only `ROOT`, `get_job`, and `save` are adapted to temporary files and a memory map. A separate process permits a real hard timeout without leaving a background rendering thread active.

The Worker must finish all R2 uploads before DELETE. If an upload fails, retry retrieval from the same container instance before cleanup. Container eviction may remove unuploaded files; the Worker must retain original inputs/seed and be able to regenerate. This service itself does not make R2 durable or coordinate multiple instances.

## Verification

```sh
python -m unittest discover -s cloudflare-backend/container -p 'test_*.py' -v
```

Five isolated HTTP test cases passed locally with the pinned dependency versions. They cover readiness, invalid input and route allowlists, concurrent admission, actual subprocess timeout and cleanup, and a complete original algorithm render with four downloadable artifacts, idempotency, input conflict, and deletion. Tests create source copies with a fake non-SQLite database sentinel and verify it remains untouched.

One local macOS sample's renderer subprocess reached 224,100,352 bytes (about 214 MiB) peak resident memory. This is not a Linux/container capacity measurement and leaves little headroom in a 256 MiB instance; validate a larger memory allocation before relying on Cloudflare throughput figures.

The `linux/amd64` Docker image was built and run locally with a 1-vCPU, 6-GiB limit. A real `[12, 1]` card pair with seed `12345` completed in 10.94 seconds, retained the original card order, and produced the image, PDF, and particle artifacts. This is one local Docker sample, not Cloudflare throughput or a 200-user capacity result. The Worker-to-storage integration and cloud deployment require separate verification.
