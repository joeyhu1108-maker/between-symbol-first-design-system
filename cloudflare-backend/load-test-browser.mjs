#!/usr/bin/env node
// HTTP acceptance using the shipped browser bridge. Does not render WebGL,
// operate NFC, or call any physical-print route.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { readArtifact } from './load-test.mjs';

const MAX_DURATION_MS = 10 * 60 * 1000;
const JOB_ID = /^SG-[0-9]{8}-[0-9]{1,40}-[A-F0-9]{8}$/;
const PAIRS = [];
for (let a = 1; a <= 12; a++) for (let b = a + 1; b <= 12; b++) PAIRS.push([a, b]);

function options(argv) {
  const config = { users: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (['--help', '-h'].includes(argv[i])) return { help: true };
    if (!['--base', '--users', '--output'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw Error('Use --base URL [--users 1..200] [--output result.json].');
    }
    config[argv[i].slice(2)] = argv[++i];
  }
  return config;
}
function validateConfig(config) {
  const users = Number(config.users ?? 1);
  if (!Number.isInteger(users) || users < 1 || users > 200) throw Error('--users must be 1 through 200.');
  if (!config.base) throw Error('--base is required; no production origin is assumed.');
  const base = new URL(config.base);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw Error('--base must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  return { users, base: base.origin,
    output: resolve(config.output || `browser-load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) };
}
function latency(values) {
  const sorted = values.filter(value => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return { count: sorted.length, p50_ms: at(.5), p95_ms: at(.95), max_ms: sorted.at(-1) ?? null };
}
function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

export async function runBrowserLoadTest(input) {
  const config = validateConfig(input);
  const bridgeSource = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
  const started = Date.now(), abort = new AbortController(), local = new AsyncLocalStorage();
  const timers = new Set(), attempts = [], active = new Set(), owners = new Map(), collisions = [];
  let sealed = false, fatal = null, preflight = null, deadlineReached = false;
  const users = Array.from({ length: config.users }, (_, i) => ({
    user: i + 1, request_id: randomUUID(), cards: PAIRS[i % PAIRS.length], started: false,
    success: false, finished: false, job_id: null, seed: null, accepted_ms: null, ready_ms: null,
    completed_ms: null, queued_first_ms: null, generating_first_ms: null, artifacts: {}
  }));
  const failIfStopped = () => { if (abort.signal.aborted) throw Error('Overall ten-minute deadline exceeded.'); };
  function clearBridgeTimer(timer) { clearTimeout(timer); timers.delete(timer); }
  function bridgeTimer(callback, ms) {
    if (abort.signal.aborted) return 0;
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
    timers.add(timer); return timer;
  }
  const storeFor = user => ({ result: user, counters: {}, previousFailed: {}, streak: {} });
  function remember(user, value) {
    if (!value?.id) return;
    if (!JOB_ID.test(value.id)) throw Error('Invalid job id.');
    if (user.job_id && user.job_id !== value.id) throw Error('Same request_id returned a different job id.');
    const owner = owners.get(value.id);
    if (owner && owner !== user.request_id) {
      collisions.push({ job_id: value.id, users: [owner, user.request_id] });
      throw Error('Independent users received the same job id.');
    }
    user.job_id = value.id; owners.set(value.id, user.request_id);
  }
  function validateJob(user, job) {
    remember(user, job);
    if (job.id !== user.job_id || !['queued', 'generating', 'ready', 'failed'].includes(job.status)) throw Error('Invalid job state.');
    if (JSON.stringify(job.params?.cards) !== JSON.stringify(user.cards)) throw Error('Job cards do not belong to this user.');
    const seed = job.params?.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Job seed is not uint32.');
    if (user.seed !== null && seed !== user.seed) throw Error('Job seed changed.');
    user.seed = seed;
  }
  async function request(path, phase, init = {}, artifact = false) {
    failIfStopped();
    const store = local.getStore();
    if (!store) throw Error('Missing user request context.');
    const user = store.result, began = Date.now();
    const ordinal = store.counters[phase] = (store.counters[phase] || 0) + 1;
    const attempt = store.streak[phase] = store.previousFailed[phase] ? (store.streak[phase] || 1) + 1 : 1;
    const record = { user: user.user, request_id: user.request_id, phase, phase_request: ordinal,
      attempt: phase === 'submit' ? ordinal : attempt, retry: phase === 'submit' ? ordinal > 1 : attempt > 1,
      path, started_ms: began - started, duration_ms: null, status: null, success: false };
    attempts.push(record); active.add(record);
    try {
      const response = await fetch(config.base + path, { ...init, redirect: 'error',
        signal: init.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal });
      record.status = response.status;
      let value;
      if (artifact) {
        if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`Artifact HTTP ${response.status}`), { httpError: true }); }
        try { value = await readArtifact(response, phase, config.base + path); record.bytes = value.bytes; }
        catch (error) {
          if (!abort.signal.aborted && !['AbortError', 'TimeoutError'].includes(error.name)) record.validation_error = error.message;
          throw error;
        }
      } else {
        // Reading the body here remains inside bridge.js's own request timeout.
        // Return the identical body to its JSON parser after recording metrics.
        const bytes = new Uint8Array(await response.arrayBuffer()); record.bytes = bytes.length;
        if (bytes.length > 512 * 1024) throw Error('JSON response exceeds 512 KiB.');
        let parsed;
        try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { record.validation_error = 'Response is not valid JSON.'; }
        if (phase === 'health') preflight = parsed ?? null;
        if (phase === 'submit' && parsed?.id) {
          try { remember(user, parsed); }
          catch (error) { record.validation_error = error.message; throw error; }
        }
        if (response.ok && ['submit', 'poll'].includes(phase) && parsed) {
          try { validateJob(user, parsed); }
          catch (error) { record.validation_error = error.message; throw error; }
        }
        value = new Response(bytes.length ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      failIfStopped();
      record.success = response.ok && !record.validation_error;
      return value;
    } catch (error) {
      record.error = String(error.message);
      record.error_name = error.name;
      throw error;
    } finally {
      if (!sealed) {
        record.duration_ms = Date.now() - began;
        if (record.status === null) record.status = 'network_error';
        store.previousFailed[phase] = !record.success;
        active.delete(record);
      }
    }
  }
  function bridgeFetch(path, init = {}) {
    const phase = path === '/api/health' ? 'health' : path === '/api/jobs' && init.method === 'POST' ? 'submit'
      : /^\/api\/jobs\/[^/]+$/.test(path) && !init.method ? 'poll' : null;
    if (!phase) throw Error('Bridge requested an unexpected route; NFC and print routes are prohibited.');
    return request(path, phase, init);
  }
  const context = vm.createContext({ Date, Math, AbortController, TypeError, URLSearchParams,
    setTimeout: bridgeTimer, clearTimeout: clearBridgeTimer, fetch: bridgeFetch });
  vm.runInContext(bridgeSource.replace(/^export /gm, '') + '\nthis.bridge={backendReady,createJob,waitForJob};', context);
  const bridge = context.bridge;
  async function userFlow(user) {
    const began = Date.now(); user.started = true; user.started_ms = began - started;
    const elapsed = () => Date.now() - began;
    function observe(job) {
      failIfStopped(); validateJob(user, job);
      if (job.status === 'queued' && user.queued_first_ms === null) user.queued_first_ms = elapsed();
      if (job.status === 'generating' && user.generating_first_ms === null) user.generating_first_ms = elapsed();
    }
    try {
      let job = await bridge.createJob(user.cards, user.request_id);
      failIfStopped(); observe(job); user.accepted_ms = elapsed();
      if (!['ready', 'failed'].includes(job.status)) job = await bridge.waitForJob(job.id, observe);
      failIfStopped(); observe(job);
      if (job.status !== 'ready') throw Error(`Generation failed: ${job.error || job.status}`);
      user.ready_ms = elapsed();
      for (const [phase, key] of [['webp', 'image'], ['pdf', 'pdf']]) {
        const path = `/printer/jobs/${user.job_id}/artwork.${phase}`;
        if (typeof job[key] !== 'string' || new URL(job[key], config.base).href !== config.base + path) throw Error(`Unexpected ${phase} URL.`);
        user.artifacts[phase] = await request(path, phase, {}, true);
      }
      failIfStopped(); user.success = true;
    } catch (error) { if (!sealed) user.error = String(error.message); }
    finally { if (!sealed) { user.completed_ms = elapsed(); user.finished = true; } }
  }
  let stop;
  const ended = new Promise(resolveEnd => { stop = resolveEnd; });
  const deadlineTimer = setTimeout(() => {
    deadlineReached = true;
    for (const user of users) if (!user.finished) user.deadline_unfinished = true;
    abort.abort(Error('Overall ten-minute deadline exceeded.'));
    for (const timer of timers) clearTimeout(timer); timers.clear(); stop('deadline');
  }, MAX_DURATION_MS);
  const progress = setInterval(() => console.error(JSON.stringify({
    completed_users: users.filter(user => user.finished).length, successful_users: users.filter(user => user.success).length,
    total_users: users.length, requests: attempts.length, elapsed_seconds: Math.round((Date.now() - started) / 1000)
  })), 10000);
  const run = (async () => {
    const healthy = await local.run(storeFor({ user: 0, request_id: null }), () => bridge.backendReady());
    failIfStopped();
    if (!healthy) throw Error('Health preflight failed.');
    await Promise.all(users.map(user => local.run(storeFor(user), () => userFlow(user))));
    return 'complete';
  })().catch(error => { if (!sealed) fatal = String(error.message); return 'failed'; });
  await Promise.race([run, ended]);
  clearTimeout(deadlineTimer); clearInterval(progress);
  if (deadlineReached) {
    for (const record of active) {
      record.duration_ms = Date.now() - started - record.started_ms;
      record.status ??= 'network_error'; record.error = 'Overall ten-minute deadline exceeded.'; record.success = false;
    }
  }
  for (const timer of timers) clearTimeout(timer); timers.clear();
  for (const user of users) {
    if (!user.finished) { user.error = deadlineReached ? 'Overall ten-minute deadline exceeded.' : fatal || 'Workflow did not finish.';
      user.deadline_unfinished = deadlineReached; user.completed_ms = user.started ? Date.now() - started - user.started_ms : null; }
  }
  sealed = true;
  const elapsed = Date.now() - started, success = users.filter(user => user.success), failed = users.filter(user => !user.success);
  const submissions = attempts.filter(attempt => attempt.phase === 'submit');
  for (const user of users) {
    const own = attempts.filter(attempt => attempt.user === user.user);
    const submits = own.filter(attempt => attempt.phase === 'submit');
    user.submit_attempts = submits.length; user.first_submit_succeeded = submits[0]?.success ?? false;
    user.retry_attempts = own.filter(attempt => attempt.retry).length;
  }
  const byPhase = Object.fromEntries(['health', 'submit', 'poll', 'webp', 'pdf'].map(phase => {
    const list = attempts.filter(attempt => attempt.phase === phase);
    return [phase, { requests: list.length, successful_attempts: list.filter(attempt => attempt.success).length,
      errors: list.filter(attempt => !attempt.success).length, retries: list.filter(attempt => attempt.retry).length,
      latency: latency(list.map(attempt => attempt.duration_ms)) }];
  }));
  const thresholds = Object.fromEntries([30, 60, 120].map(seconds => {
    const readyCount = users.filter(user => user.ready_ms !== null && user.ready_ms <= seconds * 1000).length;
    const downloaded = success.filter(user => user.completed_ms <= seconds * 1000).length;
    return [`${seconds}s`, { denominator: config.users, ready_users: readyCount, ready_ratio: readyCount / config.users,
      downloaded_users: downloaded, downloaded_ratio: downloaded / config.users }];
  }));
  const report = {
    target: config.base, requested_users: config.users, started_users: users.filter(user => user.started).length,
    started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), elapsed_ms: elapsed,
    max_duration_ms: MAX_DURATION_MS, deadline_reached: deadlineReached,
    passed: !fatal && !deadlineReached && success.length === config.users && owners.size === config.users && !collisions.length,
    preflight, fatal_error: fatal, successful_users: success.length, failed_users: failed.length,
    deadline_unfinished_users: users.filter(user => user.deadline_unfinished).length,
    unique_job_ids: owners.size, job_id_collisions: collisions,
    admission: { first_submit_success_users: users.filter(user => user.first_submit_succeeded).length,
      accepted_users: users.filter(user => user.accepted_ms !== null).length,
      accepted_after_retry_users: users.filter(user => user.accepted_ms !== null && !user.first_submit_succeeded).length,
      submit_attempts: submissions.length, submit_retry_attempts: submissions.filter(attempt => attempt.retry).length },
    completion_within: thresholds,
    artifact_downloads: { webp: users.filter(user => user.artifacts.webp).length, pdf: users.filter(user => user.artifacts.pdf).length },
    http: { requests: attempts.length, status_counts: counts(attempts.map(attempt => attempt.status)),
      failed_attempts: attempts.filter(attempt => !attempt.success).length,
      network_errors: attempts.filter(attempt => attempt.status === 'network_error').length,
      validation_errors: attempts.filter(attempt => attempt.validation_error).length,
      timeout_errors: attempts.filter(attempt => /timeout|timed out|deadline|abort/i.test((attempt.error || '') + (attempt.error_name || ''))).length,
      retry_attempts: attempts.filter(attempt => attempt.retry).length, by_phase: byPhase },
    workflow_latency: { accepted: latency(users.map(user => user.accepted_ms)), ready: latency(users.map(user => user.ready_ms)),
      downloaded: latency(success.map(user => user.completed_ms)), population: 'Each metric includes only users reaching that milestone; counts and all-user threshold ratios are reported separately.' },
    method: { bridge_source: 'bridge.js', bridge_sha256: createHash('sha256').update(bridgeSource).digest('hex'),
      concurrency: 'One simultaneous burst of independent HTTP user workflows, not sustained load or browser rendering.',
      request_policy: 'createJob/waitForJob and their timeouts, jitter, retry and polling run from the actual bridge.js source.',
      artifacts: 'One WebP then one PDF request per ready user, no artifact retry, bounded by the overall deadline.',
      retry_definition: 'Submit attempts after the first; for poll, attempts immediately following a failed HTTP/JSON request.',
      print_requests: 0, nfc_requests: 0, visual_quality_verified: false, physical_printing_verified: false },
    users, attempts
  };
  await mkdir(dirname(config.output), { recursive: true });
  await writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: config.output, passed: report.passed, requested_users: config.users,
    successful_users: success.length, failed_users: failed.length, deadline_unfinished_users: report.deadline_unfinished_users,
    first_submit_success_users: report.admission.first_submit_success_users, http_failed_attempts: report.http.failed_attempts,
    completion_p95_ms: report.workflow_latency.downloaded.p95_ms, elapsed_ms: elapsed }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = options(process.argv.slice(2));
    if (config.help) console.log('node cloudflare-backend/load-test-browser.mjs --base URL [--users 1..200] [--output result.json]\nDefault: 1. Uses actual bridge.js policy; whole run stops at 10 minutes. Creates real artworks; never prints.');
    else process.exitCode = (await runBrowserLoadTest(config)).passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
