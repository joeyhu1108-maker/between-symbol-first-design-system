import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the shipped confirmation, draw, fusion and pregeneration functions. Browser rendering and
// network boundaries are stubbed; their sequencing and state logic are real.
const source = await readFile(new URL('../prototype-3d.js', import.meta.url), 'utf8');
const start = source.indexOf('function confirmHumanCard(');
const end = source.indexOf('function syncPhone(', start);
const fusionStart = source.indexOf('function startFusion(', end);
const fusionEnd = source.indexOf('function showPrintProgress(', fusionStart);
assert.ok(start >= 0 && end > start, 'pregeneration function block not found');
assert.ok(fusionStart > end && fusionEnd > fusionStart, 'fusion function block not found');
const implementation = source.slice(start, end) + source.slice(fusionStart, fusionEnd);
const requestId = '4ec52240-63cc-4b24-9ed7-3d9917caaf08';
const queued = id => ({ id, status: 'queued', params: { cards: [1, 2] } });
const ready = id => ({ ...queued(id), status: 'ready', image: `/jobs/${id}/artwork.webp`, pdf: `/jobs/${id}/artwork.pdf` });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(create) {
  let now = 0, serial = 0;
  const timers = new Map(), elements = new Map(), events = [], posts = [];
  const state = { stage: 'selected', growth: 1, relation: null, requestId: null, rolling: false,
    answerId: null, key: null, job: null, paired: false, selected: null, matched: false,
    generation: { status: 'idle', job: null, imageUrl: null } };
  const CARDS = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(2, '0') }));
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { id, dataset: {}, style: {}, hidden: false,
        classList: { add: key => classes.add(key), remove: key => classes.delete(key),
          toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } },
        setAttribute(key, value) { this[key] = value; }, click() {} });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    state, CARDS, $: element, pendingArtwork: null, stationMode: false, nfcEnabled: false,
    entryController: { rememberRequestId: id => events.push({ type: 'remember', id, at: now }) },
    crypto: { randomUUID: () => requestId }, Uint8Array, URLSearchParams,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    performance: { now: () => now }, document: { body: { dataset: {} } },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    faceImage: card => `<img data-id="${card.id}">`,
    setStage(stage) { state.stage = stage; events.push({ type: 'stage', stage, at: now }); },
    selectedSymbols: () => [state.growth, state.relation].filter(Boolean).map(value => CARDS[value - 1]),
    isHiddenPair: () => false, setSymbolLoading() {}, mountGlyph() {},
    backendReady: async () => { events.push({ type: 'health', at: now }); return true; },
    createJob(cards, id) {
      const post = { cards: Array.from(cards), id, at: now }; posts.push(post);
      return create ? create(post, posts.length) : Promise.resolve(queued('job-one'));
    },
    waitForJob: async (id, onPoll) => { events.push({ type: 'poll', id, at: now }); const job = ready(id); onPoll?.(job); return job; },
    armNfc: (job, card) => events.push({ type: 'nfc', id: job.id, card, at: now }),
    triggerNfcFallback: () => events.push({ type: 'physical-print', at: now }),
    syncPhone: (type, data) => events.push({ type, ...data, at: now }),
    preparePrinterScene: () => events.push({ type: 'printer', at: now }),
    showPrintReady() { state.stage = 'printing'; events.push({ type: 'fusion', at: now }); },
    updatePrintReady() {}
  });
  vm.runInContext(implementation + `
    this.underTest = { confirmHumanCard, handOverToAI, preGenerateArtwork, artworkRequestId, startFusion };
  `, context);
  async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
  async function advance(to) {
    assert.ok(to >= now, 'clock must advance');
    await flush();
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > to) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn(); await flush();
    }
    now = to; await flush();
  }
  return { ...context.underTest, context, state, events, posts, elements, advance, flush, get now() { return now; } };
}

test('confirmation starts one early POST, reveals AI at 2.2s and enters fusion directly at 3.2s', async () => {
  const h = harness();
  const drawing = h.confirmHumanCard('01', 2);
  assert.deepEqual(h.posts, [{ cards: [1, 2], id: requestId, at: 0 }]);
  await h.advance(2199);
  assert.equal(h.state.relation, null);
  assert.equal(h.state.job, null);
  assert.equal(h.state.generation.status, 'idle');
  assert.equal(h.events.filter(e => e.type === 'nfc').length, 0);
  await h.advance(2200);
  assert.equal(h.state.relation, 2);
  assert.equal(h.state.stage, 'ai');
  assert.equal(h.state.job, null);
  assert.equal(h.events.filter(e => e.type === 'nfc').length, 0);
  await h.advance(3199);
  assert.equal(h.events.filter(e => e.type === 'fusion').length, 0);
  await h.advance(3200); await drawing;
  assert.deepEqual(h.events.filter(e => e.type === 'fusion'), [{ type: 'fusion', at: 3200 }]);
  assert.deepEqual(h.events.filter(e => e.type === 'nfc'), [{ type: 'nfc', id: 'job-one', card: '01', at: 3200 }]);
  assert.equal(h.events.filter(e => e.type === 'physical-print').length, 0, 'preparing NFC must not consent to a physical print');
  assert.ok(h.events.filter(e => e.type === 'stage').every(e => !['key', 'cards'].includes(e.stage)), 'no second symbol puzzle is shown');
  assert.equal(h.state.stage, 'printing');
  assert.equal(h.state.answerId, 0, 'physical symbol remains the human card');
  assert.equal(h.state.selected, 0);
  assert.equal(h.state.key, '01 · 02');
  assert.equal(h.state.paired, true);
  assert.equal(h.state.generation.status, 'ready');
  assert.equal(h.state.job, 'job-one');
  assert.equal(h.posts.length, 1);
  assert.equal(h.events.filter(e => e.type === 'health').length, 0, 'matching pending request should be consumed directly');
});

test('early submission failure is caught in fusion and retry preserves cards and request id', async () => {
  const failure = new TypeError('temporary disconnection');
  const h = harness((_post, n) => n === 1 ? Promise.reject(failure) : Promise.resolve(queued('recovered-job')));
  const drawing = h.handOverToAI(2);
  await h.advance(2199);
  assert.equal(h.state.generation.status, 'idle');
  assert.equal(h.state.relation, null);
  await h.advance(3200); await drawing;
  assert.equal(h.state.stage, 'printing');
  assert.equal(h.state.generation.status, 'failed');
  assert.equal(h.state.generation.error, failure.message);
  assert.equal(h.state.job, null);
  assert.equal(h.events.filter(e => e.type === 'nfc').length, 0);
  await h.preGenerateArtwork(h.state.key);
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.posts.map(({ cards, id }) => ({ cards, id })), [
    { cards: [1, 2], id: requestId }, { cards: [1, 2], id: requestId }
  ]);
  assert.equal(h.state.generation.status, 'ready');
  assert.equal(h.state.job, 'recovered-job');
});

for (const at of [1000, 2500]) {
  test(`abandoning draw at ${at}ms does not enter fusion or adopt its late artwork`, async () => {
    const pending = deferred(), h = harness(() => pending.promise);
    const drawing = h.handOverToAI(2);
    await h.advance(at);
    h.state.stage = 'entry'; h.state.growth = null; h.state.requestId = 'new-session';
    pending.resolve(queued('discarded-job'));
    await h.advance(5000); await drawing;
    assert.equal(h.posts.length, 1);
    assert.equal(h.events.filter(e => e.type === 'fusion').length, 0);
    assert.equal(h.events.filter(e => e.type === 'nfc' || e.type === 'poll' || e.type === 'job-created').length, 0);
    assert.equal(h.state.job, null);
    assert.equal(h.state.generation.status, 'idle');
  });
}

test('pending artwork from different cards/request id is not adopted by a later fusion', async () => {
  const old = deferred();
  const h = harness((_post, n) => n === 1 ? old.promise : Promise.resolve(queued('new-job')));
  const drawing = h.handOverToAI(2);
  await h.advance(1000);
  Object.assign(h.state, { stage: 'entry', growth: 3, relation: 4, requestId: 'another-request', answerId: 0, key: 'new-key' });
  await h.advance(2200); await drawing;
  h.state.stage = 'printing';
  await h.preGenerateArtwork('new-key');
  old.resolve(queued('old-job')); await h.flush();
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.posts[1].cards, [3, 4]);
  assert.equal(h.posts[1].id, 'another-request');
  assert.equal(h.state.job, 'new-job');
  assert.ok(h.events.filter(e => e.type === 'nfc' || e.type === 'poll').every(e => e.id === 'new-job'));
});

test('abandoning fusion while awaiting submission cannot adopt the old result into a new session', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const drawing = h.handOverToAI(2);
  await h.advance(3200); await drawing;
  assert.equal(h.state.generation.status, 'generating');
  Object.assign(h.state, { stage: 'entry', growth: 3, relation: 4, requestId: 'next-session', key: null,
    generation: { status: 'idle', job: null, imageUrl: null } });
  pending.resolve(queued('abandoned-key-job')); await h.flush();
  assert.equal(h.state.job, null, 'old submission must not replace the new session job');
  assert.equal(h.events.filter(e => e.type === 'nfc' || e.type === 'job-created' || e.type === 'poll').length, 0);
  assert.equal(h.state.generation.status, 'idle');
});

test('abandoned submission failure cannot overwrite a new session UI', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const drawing = h.handOverToAI(2);
  await h.advance(3200); await drawing;
  Object.assign(h.state, { stage: 'entry', growth: 3, relation: 4, requestId: 'next-session', key: null,
    generation: { status: 'idle', job: null, imageUrl: null } });
  h.context.$('printCopy').textContent = 'new session';
  pending.reject(Error('old request disconnected')); await h.flush();
  assert.equal(h.elements.get('printCopy').textContent, 'new session');
  assert.equal(h.state.generation.status, 'idle');
});

test('abandoned polling completion cannot publish old artwork or prepare its printer scene', async () => {
  const result = deferred(), h = harness();
  let report;
  h.context.waitForJob = (_id, onPoll) => { report = onPoll; return result.promise; };
  const drawing = h.handOverToAI(2);
  await h.advance(3200); await drawing;
  assert.equal(h.state.job, 'job-one');
  Object.assign(h.state, { stage: 'entry', growth: 3, relation: 4, requestId: 'next-session', key: null, job: null,
    generation: { status: 'idle', job: null, imageUrl: null } });
  h.context.$('printCopy').textContent = 'new session';
  const eventCount = h.events.length;
  report(ready('job-one')); result.resolve(ready('job-one')); await h.flush();
  assert.equal(h.state.job, null);
  assert.equal(h.state.generation.status, 'idle');
  assert.equal(h.elements.get('printCopy').textContent, 'new session');
  assert.equal(h.events.length, eventCount, 'old readiness must not sync to phone or prepare scene');
});

test('a different physical symbol cannot start AI or replace the selected session request', async () => {
  const h = harness();
  h.state.requestId = 'selected-session';
  await h.confirmHumanCard('02', 3, 'wrong-card-request');
  assert.equal(h.state.stage, 'selected');
  assert.equal(h.state.growth, 1);
  assert.equal(h.state.relation, null);
  assert.equal(h.state.requestId, 'selected-session');
  assert.equal(h.posts.length, 0);
  assert.equal(h.events.length, 0);
});

test('NFC and button confirmations racing each other create only one draw and retain its request id', async () => {
  const h = harness();
  const first = h.confirmHumanCard('01', 2, 'confirmed-session');
  const duplicate = h.confirmHumanCard(1, 3, 'duplicate-session');
  assert.equal(h.posts.length, 1);
  assert.equal(h.state.requestId, 'confirmed-session');
  assert.deepEqual(h.posts[0].cards, [1, 2]);
  await h.advance(3200); await Promise.all([first, duplicate]);
  assert.equal(h.state.relation, 2);
  assert.equal(h.events.filter(e => e.type === 'fusion').length, 1);
  await h.confirmHumanCard('01', 4, 'late-confirmation');
  await h.startFusion();
  assert.equal(h.state.requestId, 'confirmed-session');
  assert.equal(h.posts.length, 1);
  assert.equal(h.events.filter(e => e.type === 'fusion').length, 1);
  assert.equal(h.events.filter(e => e.type === 'physical-print').length, 0);
});

test('AI cannot draw before a human card is selected', async () => {
  const h = harness();
  h.state.stage = 'input';
  await h.confirmHumanCard('01', 2, 'premature-confirmation');
  await h.handOverToAI(2);
  assert.equal(h.state.stage, 'input');
  assert.equal(h.state.requestId, null);
  assert.equal(h.posts.length, 0);
});

test('next participant waits for session cleanup, ignores duplicate clicks and preserves only station settings', async t => {
  const restartStart = source.indexOf('async function restartExperience(');
  const restartEnd = source.indexOf("window.addEventListener('message'", restartStart);
  assert.ok(restartStart >= 0 && restartEnd > restartStart, 'restart function block not found');
  const restartImplementation = source.slice(restartStart, restartEnd);
  for (const [label, stationMode, nfcEnabled, expectedPath] of [
    ['public entrance', false, false, '/'],
    ['station entrance', true, false, '/prototype-3d.html?mode=station'],
    ['station with NFC', true, true, '/prototype-3d.html?mode=station&nfc=1']
  ]) {
    await t.test(label, async () => {
      const cleanup = deferred(), events = [], clearedTimers = [], restartButton = { disabled: false, setAttribute() {} };
      const generation = { status: 'ready', paperPrint: 'idle', paperRetryTimer: 42 };
      const initial = 'https://between.zone-y.com/prototype-3d.html?card=01&local=1&mode=station&nfc=1&v=old';
      let href = initial;
      const context = vm.createContext({
        stationMode, nfcEnabled,
        $: id => { assert.equal(id, 'restart'); return restartButton; },
        mountSymbolLoading: button => { assert.equal(button, restartButton); events.push('loading'); },
        state: { generation, printerView: { close: () => events.push('printer-close') } },
        clearTimeout: id => clearedTimers.push(id),
        entryController: { reset: () => { events.push('reset'); return cleanup.promise; } },
        location: { get href() { return href; }, set href(value) { href = new URL(value, initial).href; events.push('navigate'); } }
      });
      vm.runInContext(restartImplementation + ';this.restart = restartExperience;', context);
      const first = context.restart();
      await context.restart();
      assert.equal(restartButton.disabled, true);
      assert.equal(generation.paperPrintStopped, true, 'the old round cannot submit while session cleanup is pending');
      assert.deepEqual(clearedTimers, [42], 'the pending paper retry is cancelled exactly once');
      assert.deepEqual(events, ['loading', 'printer-close', 'reset'], 'duplicate clicks must not repeat cleanup or close the printer again');
      assert.equal(href, initial, 'navigation must wait for the old session to close');
      cleanup.resolve(); await first;
      assert.deepEqual(events, ['loading', 'printer-close', 'reset', 'navigate']);
      assert.equal(href, new URL(expectedPath, initial).href);
      assert.equal(new URL(href).searchParams.has('card'), false, 'the previous participant card must not carry into the next round');
    });
  }
});
