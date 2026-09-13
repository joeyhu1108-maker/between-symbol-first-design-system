import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Compile the shipped functions in an isolated browser-like context. Only export
// keywords are removed; neither retry nor polling implementation is copied.
const source = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
const printerSource = await readFile(new URL('../printer/app.js', import.meta.url), 'utf8');
function response(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, statusText: `HTTP ${status}`,
    headers: new Headers(headers), async json() { return body; } };
}
function harness(respond) {
  let now = 0, serial = 0;
  const timers = new Map(), calls = [];
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    AbortController, TypeError, URLSearchParams,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) {
      const call = { url, body: init?.body, method: init?.method, now };
      calls.push(call);
      return respond(call, calls.length);
    }
  });
  vm.runInContext(source.replace(/^export /gm, '') + '\nthis.bridge={createJob,waitForJob};', context);
  async function settle(promise) {
    let done = false, result, failure;
    promise.then(value => { done = true; result = value; }, error => { done = true; failure = error; });
    for (let step = 0; step < 10000; step++) {
      // Flush fetch(), response.json(), finally and the caller before time moves.
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
      if (done) { if (failure) throw failure; return result; }
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'promise did not settle and scheduled no timer');
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    throw Error('fake clock exceeded 10000 timer steps');
  }
  return { ...context.bridge, calls, settle, get now() { return now; }, get pendingTimers() { return timers.size; } };
}
const requestId = 'c26022ca-5c33-47ce-8063-6f8a040f22b0';

test('createJob preserves request id and body through 503, 429 and a dropped connection', async () => {
  const h = harness((_call, n) => {
    if (n === 1) return response(503, { error: 'temporarily unavailable' });
    if (n === 2) return response(429, { error: 'full' }, { 'Retry-After': '8' });
    if (n === 3) throw new TypeError('network disconnected');
    return response(201, { id: 'same-job', status: 'queued' });
  });
  const job = await h.settle(h.createJob([12, 1], requestId));
  assert.equal(job.id, 'same-job');
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every(call => call.url === '/api/jobs' && call.method === 'POST'));
  assert.equal(new Set(h.calls.map(call => call.body)).size, 1);
  assert.deepEqual(JSON.parse(h.calls[0].body), { cards: [12, 1], request_id: requestId });
  assert.ok(h.calls[2].now - h.calls[1].now >= 8000, 'Retry-After must be respected');
  assert.equal(h.pendingTimers, 0);
});

test('createJob stops immediately on HTTP 400', async () => {
  const h = harness(() => response(400, { error: 'invalid cards' }));
  await assert.rejects(h.settle(h.createJob([1, 1], requestId)), error => error.status === 400 && error.message === 'invalid cards');
  assert.equal(h.calls.length, 1);
  assert.equal(h.now, 0);
});

test('createJob bounds queue-full retry to two minutes while keeping the original submission', async () => {
  const h = harness(() => response(429, { error: 'full', retry_after: 30 }));
  await assert.rejects(h.settle(h.createJob([1, 2], requestId)), error => error.status === 429);
  assert.ok(h.now <= 120000);
  assert.equal(new Set(h.calls.map(call => call.body)).size, 1);
  assert.equal(h.pendingTimers, 0);
});

test('waitForJob continues beyond five minutes and recovers from 503 without changing job id', async () => {
  const seen = [];
  const h = harness(call => {
    if (call.now >= 310000) return response(200, { id: 'job /1', status: 'ready' });
    if (call.now === 302000) return response(503, { error: 'recovering' }, { 'Retry-After': '3' });
    return response(200, { id: 'job /1', status: 'queued' });
  });
  const job = await h.settle(h.waitForJob('job /1', value => seen.push(value.status)));
  assert.equal(job.status, 'ready');
  assert.ok(h.now >= 310000);
  assert.ok(h.calls.some(call => call.now === 302000));
  assert.ok(h.calls.some(call => call.now === 305000), '503 Retry-After should resume polling');
  assert.ok(h.calls.every(call => call.url === '/api/jobs/job%20%2F1' && call.method === undefined));
  assert.equal(seen.at(-1), 'ready');
  assert.equal(h.pendingTimers, 0);
});

test('waitForJob returns terminal failed job to caller', async () => {
  const h = harness(() => response(200, { id: 'failed-job', status: 'failed', error: 'render failed' }));
  const job = await h.settle(h.waitForJob('failed-job'));
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'render failed');
  assert.equal(h.calls.length, 1);
});

test('waitForJob ends at 30 minutes and never creates a replacement job', async () => {
  const h = harness(() => response(200, { id: 'long-job', status: 'queued' }));
  await assert.rejects(h.settle(h.waitForJob('long-job')), /请点击重试继续查看原来的作品/);
  assert.equal(h.now, 1800000);
  assert.ok(h.calls.every(call => call.url === '/api/jobs/long-job'));
  assert.equal(h.pendingTimers, 0);
});

test('waitForJob also respects its deadline during repeated transient HTTP failures', async () => {
  const h = harness(() => response(503, { error: 'recovering', retry_after: 29 }));
  await assert.rejects(h.settle(h.waitForJob('long-job')), /请点击重试继续查看原来的作品/);
  assert.equal(h.now, 1800000);
  assert.ok(h.calls.every(call => call.url === '/api/jobs/long-job'));
  assert.equal(h.pendingTimers, 0);
});

test('waitForJob does not swallow a synchronous poll callback error', async () => {
  const failure = new TypeError('UI update failed');
  const h = harness(() => response(200, { id: 'job', status: 'generating' }));
  await assert.rejects(h.settle(h.waitForJob('job', () => { throw failure; })), error => error === failure);
  assert.equal(h.calls.length, 1);
  assert.equal(h.pendingTimers, 0);
});

// Extract complete declared functions from the real printer module without
// importing Three.js or starting a WebGL renderer in Node.
function printerFunction(name, nextName) {
  const start = printerSource.indexOf(`async function ${name}(`);
  const end = printerSource.indexOf(`async function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `could not find printer ${name} boundary`);
  return printerSource.slice(start, end);
}
function printerContext(overrides = {}) {
  const elements = new Map();
  const state = { loaded: true, running: false, failed: false, mode: 'live', job: null };
  const params = { m: 12, n: 1, a: 0.8, b: 0.6, seed: 123 };
  const failures = [], submissions = [], polls = [], questionBindings = [];
  const questionReveal = {
    reset() {},
    bind: parameters => questionBindings.push(parameters),
    question: { text: '这次相遇让什么开始生长？' }
  };
  const context = vm.createContext({
    state, params, questionReveal, query: new URLSearchParams(),
    $: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
    crypto: { randomUUID: () => requestId }, Uint8Array, URLSearchParams,
    begin: () => { state.running = true; state.failed = false; },
    showError: message => { failures.push(message); state.failed = true; state.running = false; },
    poll: (...args) => polls.push(args),
    createJob: async (cards, id) => { submissions.push({ cards: Array.from(cards), id }); return { id: 'job1', status: 'queued', params: { ...params, cards: Array.from(cards) } }; },
    ...overrides
  });
  return { context, state, params, elements, failures, submissions, polls, questionBindings };
}

test('printer start uses card contract and preserves requestId after submission failure', async () => {
  const p = printerContext();
  let attempts = 0;
  p.context.createJob = async (cards, id) => {
    p.submissions.push({ cards: Array.from(cards), id });
    if (++attempts === 1) throw new TypeError('network unavailable');
    return { id: 'job1', status: 'queued', params: { ...p.params, cards: Array.from(cards) } };
  };
  vm.runInContext(printerFunction('start', 'refreshPrinters') + '\nthis.startUnderTest=start;', p.context);
  await p.context.startUnderTest();
  assert.equal(p.state.failed, true);
  assert.equal(p.state.requestId, requestId);
  await p.context.startUnderTest();
  assert.deepEqual(p.submissions, [{ cards: [12, 1], id: requestId }, { cards: [12, 1], id: requestId }]);
  assert.deepEqual(p.polls, [['job1', 'live']]);
  assert.equal(p.state.failed, false);
  assert.equal(p.questionBindings.length, 1);
  assert.equal(p.questionBindings[0], p.state.job.params, 'the recovered job supplies its exact parameters to the question');
  assert.deepEqual(p.questionBindings[0].cards, [12, 1]);
});

test('printer start uses crypto.getRandomValues UUID fallback when randomUUID is absent', async () => {
  const p = printerContext({ crypto: { getRandomValues: array => array.fill(15) } });
  vm.runInContext(printerFunction('start', 'refreshPrinters') + '\nthis.startUnderTest=start;', p.context);
  await p.context.startUnderTest();
  assert.equal(p.state.requestId, '0f'.repeat(16));
  assert.deepEqual(p.submissions, [{ cards: [12, 1], id: '0f'.repeat(16) }]);
});

test('printer adoptJob uses the ready manifest parameters and downloadable artifact URLs', async () => {
  const requested = [], stored = [], oldTexture = { dispose() { this.disposed = true; } };
  const p = printerContext({
    particleData: null, texture: oldTexture,
    fetch: async url => { requested.push(url); return { json: async () => ({ positions: [1, 2, 3] }) }; },
    THREE: { SRGBColorSpace: 'srgb', TextureLoader: class { async loadAsync(url) { requested.push(url); return { image: {}, url }; } } },
    renderer: { capabilities: { getMaxAnisotropy: () => 16 } }, output: { material: {} },
    sampleGardenColors() {}, sessionStorage: { setItem: (...args) => stored.push(args) }
  });
  vm.runInContext(printerFunction('adoptJob', 'poll') + '\nthis.adoptUnderTest=adoptJob;', p.context);
  const job = { id: 'ready-job', status: 'ready', params: { cards: [12, 1], m: 1, n: 12, a: 0.32, b: 0.81, seed: 4294967295 }, particles: '/p.json', image: '/a.webp', pdf: '/a.pdf',
    story: { title: '归档作品', story: '同一组种子', cards: [], perspective: '共生', relation: '相遇', signature: '原始参数' } };
  await p.context.adoptUnderTest(job);
  assert.equal(p.state.job, job);
  assert.equal(p.params.seed, 4294967295);
  assert.equal(p.params.m, 1);
  assert.equal(p.params.a, 0.32);
  assert.equal(p.elements.get('seed').textContent, 'FFFFFFFF');
  assert.equal(p.elements.get('download').href, '/a.pdf');
  assert.deepEqual(requested, ['/p.json', '/a.webp']);
  assert.deepEqual(stored, [['seed-press-job', 'ready-job']]);
  assert.equal(oldTexture.disposed, true);
  assert.equal(p.questionBindings.length, 1);
  assert.equal(p.questionBindings[0], job.params, 'question and artwork must bind to the same archived manifest');
  assert.equal(p.elements.get('storyQuestion').textContent, p.context.questionReveal.question.text);
});

function installPrinterPoll(context) {
  const start = printerSource.indexOf('async function poll(');
  const end = printerSource.indexOf('function begin()', start);
  assert.ok(start >= 0 && end > start, 'could not find printer poll boundary');
  vm.runInContext(printerSource.slice(start, end) + '\nthis.pollUnderTest=poll;', context);
}

test('printer terminal failed polling updates state, so the next start obtains a new request id', async () => {
  const failed = { id: 'failed-render', status: 'failed', error: 'render failed' };
  const h = harness(() => response(200, failed));
  const p = printerContext({ waitForJob: h.waitForJob });
  Object.assign(p.state, { job: { id: failed.id, status: 'queued' }, requestId: 'previous-request', running: true });
  installPrinterPoll(p.context);
  vm.runInContext(printerFunction('start', 'refreshPrinters') + '\nthis.startUnderTest=start;', p.context);
  await h.settle(p.context.pollUnderTest(failed.id, 'live'));
  assert.equal(p.state.job, failed, 'terminal manifest must be kept before reporting its error');
  assert.equal(p.state.failed, true);
  assert.deepEqual(p.failures, ['render failed']);
  // The next independent polling cycle is covered below; this checks start's
  // real request-id decision after the actual failed poll has returned.
  p.context.poll = (...args) => p.polls.push(args);
  await p.context.startUnderTest();
  assert.deepEqual(p.submissions, [{ cards: [12, 1], id: requestId }]);
  assert.notEqual(p.state.requestId, 'previous-request');
  assert.equal(p.state.failed, false);
  assert.deepEqual(p.polls, [['job1', 'live']]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.pendingTimers, 0);
});

test('printer poll automatically recovers from 503 through the real bridge and adopts the same ready job', async () => {
  const jobId = 'recovering-render', adopted = [];
  const h = harness((_call, n) => {
    if (n === 1) return response(503, { error: 'temporarily unavailable' }, { 'Retry-After': '3' });
    return response(200, { id: jobId, status: n === 2 ? 'queued' : n === 3 ? 'generating' : 'ready' });
  });
  const p = printerContext({
    waitForJob: h.waitForJob, startClock: 0, performance: { now: () => h.now },
    adoptJob: async job => adopted.push(job)
  });
  Object.assign(p.state, { job: { id: jobId, status: 'queued' }, requestId, running: true });
  installPrinterPoll(p.context);
  await h.settle(p.context.pollUnderTest(jobId, 'live'));
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every(call => call.url === '/api/jobs/' + jobId && call.method === undefined));
  assert.equal(h.calls[1].now, 3000);
  assert.deepEqual(p.failures, []);
  assert.equal(p.state.failed, false);
  assert.equal(p.state.requestId, requestId);
  assert.equal(p.state.job.status, 'ready');
  assert.equal(p.state.readyAt, 6);
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0], p.state.job);
  assert.equal(h.pendingTimers, 0);
});
