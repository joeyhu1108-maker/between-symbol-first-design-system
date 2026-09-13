#!/usr/bin/env node
// Explicit HTTP workflow load test. Never calls any print or NFC endpoint.
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

const MAX_DURATION_MS = 10 * 60 * 1000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const JOB_ID = /^SG-[0-9]{8}-[0-9]{1,40}-[A-F0-9]{8}$/;
const pairs = [];
for (let a = 1; a <= 12; a++) for (let b = a + 1; b <= 12; b++) pairs.push([a, b]);

function options(argv) {
  const value = {users: 1};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return {help: true};
    const key = argv[i];
    if (!['--base', '--users', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw Error('Use --base URL [--users 1..200] [--output result.json].');
    }
    value[key.slice(2)] = argv[++i];
  }
  if (!value.base) throw Error('--base is required; no production target is assumed.');
  value.users = Number(value.users);
  if (!Number.isInteger(value.users) || value.users < 1 || value.users > 200) throw Error('--users must be 1 through 200.');
  const base = new URL(value.base);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw Error('--base must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  value.base = base.href.replace(/\/$/, '');
  value.output = resolve(value.output || `load-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  return value;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] * 100) / 100;
}

function latencySummary(values) {
  return {count: values.length, p50_ms: percentile(values, .5), p95_ms: percentile(values, .95),
    max_ms: values.length ? Math.round(Math.max(...values) * 100) / 100 : null};
}

function retryDelay(header, attempt) {
  const seconds = Number(header);
  const specified = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()) : 0;
  const minimum = Math.max(0, Math.min(30000, specified || 0));
  return Math.min(30000, Math.max(minimum, 500 * 2 ** Math.min(attempt, 5))) * (1 + Math.random() * .25);
}

export async function readArtifact(response, kind, expectedURL) {
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const wanted = kind === 'pdf' ? 'application/pdf' : 'image/webp';
  if (mime !== wanted) throw Error(`Expected ${wanted}, received ${mime || 'no content type'}.`);
  if (!response.body) throw Error('Artifact body is empty.');
  const hash = createHash('sha256');
  let bytes = 0, head = Buffer.alloc(0), tail = Buffer.alloc(0);
  for await (const part of response.body) {
    const chunk = Buffer.from(part);
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) throw Error('Artifact exceeds the 16 MiB test safety limit.');
    hash.update(chunk);
    if (head.length < 32) head = Buffer.concat([head, chunk]).subarray(0, 32);
    tail = Buffer.concat([tail, chunk]).subarray(-1024);
  }
  const declared = response.headers.get('Content-Length');
  const encoded = response.headers.get('Content-Encoding');
  if (declared && (!encoded || encoded === 'identity') && Number(declared) !== bytes) throw Error('Artifact Content-Length mismatch.');
  if (kind === 'pdf') {
    if (head.subarray(0, 5).toString() !== '%PDF-' || !tail.includes(Buffer.from('%%EOF'))) throw Error('Invalid PDF header or end marker.');
  } else if (head.length < 12 || head.subarray(0, 4).toString() !== 'RIFF'
      || head.subarray(8, 12).toString() !== 'WEBP' || head.readUInt32LE(4) + 8 !== bytes) {
    throw Error('Invalid WebP RIFF header or length.');
  }
  return {url: expectedURL, bytes, content_type: mime, sha256: hash.digest('hex')};
}

export async function runLoadTest(config) {
  const started = Date.now(), deadline = started + MAX_DURATION_MS;
  const abort = new AbortController();
  const deadlineTimer = setTimeout(() => abort.abort(Error('Ten-minute test deadline exceeded.')), MAX_DURATION_MS);
  const attempts = [], users = [], jobOwners = new Map(), collisions = [];
  const phase = {health: [], submit: [], poll: [], pdf: [], webp: []};
  let preflight = null, fatal = null, finishedUsers = 0;
  const endpoint = path => config.base + path;
  const pause = delay => sleep(Math.min(delay, Math.max(1, deadline - Date.now())), undefined, {signal: abort.signal});
  const progress = setInterval(() => console.error(JSON.stringify({completed_users: finishedUsers,
    total_users: config.users, requests: attempts.length, elapsed_seconds: Math.round((Date.now() - started) / 1000)})), 10000);

  async function request(path, name, {body, observe} = {}) {
    for (let attempt = 0; ; attempt++) {
      if (abort.signal.aborted || Date.now() >= deadline) throw Error('Ten-minute test deadline exceeded.');
      const began = Date.now(), url = endpoint(path);
      let response, value, networkError = null, validationError = null, identityError = false;
      try {
        response = await fetch(url, {method: body ? 'POST' : 'GET', redirect: 'error',
          headers: body ? {'Content-Type': 'application/json'} : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now())))])});
        if (response.ok && (name === 'pdf' || name === 'webp')) {
          try {value = await readArtifact(response, name, url);}
          catch (error) {validationError = error;}
        } else {
          try {value = await response.json();}
          catch {validationError = Error('Response is not valid JSON.');}
          if (value && observe) {
            try {observe(value);}
            catch (error) {validationError = error; identityError = true;}
          }
        }
      } catch (error) {networkError = error;}
      const duration = Date.now() - began;
      phase[name].push(duration);
      attempts.push({phase: name, status: response?.status || 'network_error', duration_ms: duration,
        ...(networkError ? {error: String(networkError.message)} : {}),
        ...(validationError ? {validation_error: validationError.message} : {})});
      if (!networkError && !validationError && response?.ok) return value;
      if (validationError && (response?.ok || identityError)) {
        await response?.body?.cancel().catch(() => {});
        throw validationError;
      }
      if (!networkError && !RETRYABLE.has(response?.status)) {
        throw Error(`${name} HTTP ${response?.status}: ${value?.error || validationError?.message || 'request rejected'}`);
      }
      await pause(retryDelay(response?.headers.get('Retry-After') || value?.retry_after, attempt));
    }
  }

  async function user(index) {
    const began = Date.now();
    const result = {user: index + 1, request_id: randomUUID(), cards: pairs[index % pairs.length],
      job_id: null, accepted_ms: null, ready_ms: null, completed_ms: null, success: false, polls: 0};
    users.push(result);
    function remember(value) {
      if (!value.id) return;
      if (!JOB_ID.test(value.id)) throw Error('Server returned an invalid job id.');
      if (result.job_id && result.job_id !== value.id) throw Error('Same request_id returned a different job id on retry.');
      result.job_id = value.id;
      const owner = jobOwners.get(value.id);
      if (owner && owner !== result.request_id) {
        collisions.push({job_id: value.id, users: [owner, result.request_id]});
        throw Error('Independent users received the same job id.');
      }
      jobOwners.set(value.id, result.request_id);
    }
    function validateJob(job) {
      remember(job);
      if (job.id !== result.job_id || !['queued', 'generating', 'ready', 'failed'].includes(job.status)) throw Error('Invalid job state response.');
      if (JSON.stringify(job.params?.cards) !== JSON.stringify(result.cards)) throw Error('Job cards do not belong to this user.');
      if (!Number.isInteger(job.params?.seed) || job.params.seed < 0 || job.params.seed > 0xffffffff) throw Error('Job has no valid random seed.');
      if (result.seed !== undefined && result.seed !== job.params.seed) throw Error('Job random seed changed during polling.');
      result.seed = job.params.seed;
    }
    try {
      let job = await request('/api/jobs', 'submit', {body: {cards: result.cards, request_id: result.request_id}, observe: remember});
      validateJob(job);
      result.accepted_ms = Date.now() - began;
      while (job.status !== 'ready') {
        if (job.status === 'failed') throw Error(`Generation failed: ${job.error || 'no reason returned'}`);
        await pause(Math.min(8000, 750 * 1.35 ** Math.min(result.polls, 9)) * (.8 + Math.random() * .4));
        job = await request(`/api/jobs/${result.job_id}`, 'poll');
        result.polls++;
        validateJob(job);
      }
      result.ready_ms = Date.now() - began;
      result.artifacts = {};
      for (const [kind, key] of [['webp', 'image'], ['pdf', 'pdf']]) {
        const path = `/printer/jobs/${result.job_id}/artwork.${kind}`;
        if (typeof job[key] !== 'string' || new URL(job[key], endpoint('/')).href !== endpoint(path)) {
          throw Error(`Unexpected ${kind} URL; refusing to fetch another origin or job.`);
        }
        result.artifacts[kind] = await request(path, kind);
      }
      result.success = true;
    } catch (error) {
      result.error = String(error.message);
    } finally {
      result.completed_ms = Date.now() - began;
      finishedUsers++;
    }
  }

  try {
    preflight = await request('/api/health', 'health');
    if (preflight.ok !== true) throw Error('Health endpoint did not confirm readiness.');
    await Promise.all(Array.from({length: config.users}, (_, i) => user(i)));
  } catch (error) {fatal = String(error.message);}
  finally {clearTimeout(deadlineTimer); clearInterval(progress);}

  const counts = {};
  for (const attempt of attempts) counts[attempt.status] = (counts[attempt.status] || 0) + 1;
  const complete = users.filter(value => value.success);
  const workflowErrors = users.filter(value => !value.success);
  const completed = Date.now();
  const report = {
    target: config.base, requested_users: config.users, started_users: users.length,
    started_at: new Date(started).toISOString(), finished_at: new Date(completed).toISOString(),
    elapsed_ms: completed - started, max_duration_ms: MAX_DURATION_MS,
    passed: !fatal && complete.length === config.users && jobOwners.size === config.users && collisions.length === 0,
    preflight, fatal_error: fatal, successful_users: complete.length, failed_users: workflowErrors.length,
    unique_job_ids: jobOwners.size, job_id_collisions: collisions,
    artifact_downloads: {webp: users.filter(value => value.artifacts?.webp).length,
      pdf: users.filter(value => value.artifacts?.pdf).length},
    http: {requests: attempts.length, status_counts: counts,
      non_2xx_attempts: attempts.filter(value => typeof value.status !== 'number' || value.status < 200 || value.status > 299).length,
      validation_errors: attempts.filter(value => value.validation_error).length,
      latency: latencySummary(attempts.map(value => value.duration_ms)),
      by_phase: Object.fromEntries(Object.entries(phase).map(([key, values]) => [key, latencySummary(values)]))},
    workflow_latency: {accepted: latencySummary(users.filter(value => value.accepted_ms !== null).map(value => value.accepted_ms)),
      ready: latencySummary(users.filter(value => value.ready_ms !== null).map(value => value.ready_ms)),
      fully_completed: latencySummary(complete.map(value => value.completed_ms))},
    safety: {print_requests: 0, nfc_requests: 0, artifact_bytes_limit_each: 16 * 1024 * 1024,
      validation: 'Same-user job id/cards/seed plus MIME, file header, length and SHA256; no visual quality or physical printing claim.'},
    users: users.sort((a, b) => a.user - b.user),
    failed_attempts: attempts.filter(value => value.error || value.validation_error
      || typeof value.status !== 'number' || value.status < 200 || value.status > 299)
  };
  await mkdir(dirname(config.output), {recursive: true});
  await writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output: config.output, passed: report.passed, requested_users: config.users,
    successful_users: complete.length, unique_job_ids: jobOwners.size, failed_users: workflowErrors.length,
    http_statuses: counts, request_p95_ms: report.http.latency.p95_ms,
    completion_p95_ms: report.workflow_latency.fully_completed.p95_ms, elapsed_ms: report.elapsed_ms}));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = options(process.argv.slice(2));
    if (config.help) {
      console.log('node cloudflare-backend/load-test.mjs --base URL [--users 1..200] [--output result.json]\nDefault: 1 user. A 200-user run requires --users 200. Maximum duration: 10 minutes. Creates real artworks; never prints.');
    } else {
      const report = await runLoadTest(config);
      process.exitCode = report.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
