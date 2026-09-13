"""Verify every file in the published handoff snapshot, using only Python stdlib."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'docs/upload-manifest.json').read_text(encoding='utf-8'))
errors = []
for item in manifest['files']:
    path = ROOT / item['path']
    if not path.is_file():
        errors.append('MISSING ' + item['path'])
        continue
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if path.stat().st_size != item['size'] or digest.hexdigest() != item['sha256']:
        errors.append('CHANGED ' + item['path'])
if errors:
    raise SystemExit('\n'.join(errors))
print(f"PASS: {len(manifest['files'])} files match the handoff SHA-256 manifest.")
