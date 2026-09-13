import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';

// Model workerd's fixed-length stream contract, which Node does not provide.
const streamLengths = new WeakMap();
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(size) {
    let written = 0;
    super({
      transform(chunk, controller) {
        written += chunk.byteLength;
        if (written > size) throw Error('FixedLengthStream overflow');
        controller.enqueue(chunk);
      },
      flush() {if (written !== size) throw Error('FixedLengthStream underflow');}
    });
    streamLengths.set(this.readable, size);
  }
};

// The platform Container base class and fixed-length streams are stubbed. Handlers run
// against real SQLite SQL and in-memory service bindings; no public services run.
const source = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(source.replace("import {Container} from '@cloudflare/containers';", 'class Container {}')).toString('base64')}`);
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const FILES = ['artwork.png','artwork.webp','artwork.pdf','particles.json'];
const ORIGIN = 'https://between.example';

class D1 {
  constructor() {this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(schema);}
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    let values = [];
    const binding = {
      bind(...args) {values = args; return binding;},
      async run() {const result = statement.run(...values); return {success:true, meta:{changes:Number(result.changes)}};},
      async first() {return statement.get(...values) || null;},
      async all() {return {results:statement.all(...values)};}
    };
    return binding;
  }
  async batch(statements) {return Promise.all(statements.map(statement => statement.run()));}
}

function bindings(t) {
  const DB = new D1(); t.after(() => DB.sqlite.close());
  const objects = new Map(), queued = [], calls = [], cached = new Map();
  const state = {queueFailure:false, failPut:null, renderStatus:200, renderGate:null, renderGates:new Map(), renderStatuses:new Map(), workCount:0, slots:[], corruptManifest:false, artifactSizeDelta:0, putGates:new Map(), activePuts:0, maxPuts:0};
  const env = {
    DB,
    GENERATION_QUEUE:{
      async send(body) {if (state.queueFailure) throw Error('offline'); queued.push(body);},
      async sendBatch(batch) {if (state.queueFailure) throw Error('offline'); queued.push(...batch.map(message => message.body));}
    },
    ARTWORKS:{
      async put(key, stream, options) {
        assert.ok(streamLengths.has(stream), 'R2 requires a known-length stream');
        const name = key.split('/').at(-1);
        state.activePuts++; state.maxPuts = Math.max(state.maxPuts, state.activePuts);
        try {
          if (state.failPut === name) throw Error('R2 interrupted');
          const data = new Uint8Array(await new Response(stream).arrayBuffer());
          assert.equal(data.length, streamLengths.get(stream));
          if (state.putGates.has(name)) await state.putGates.get(name);
          objects.set(key, {data, options}); return {key};
        } finally {state.activePuts--;}
      },
      async get(key) {const entry = objects.get(key); return entry ? {body:new Response(entry.data).body, size:entry.data.length, httpEtag:'"test-etag"'} : null;},
      async head(key) {const entry = objects.get(key); return entry ? {size:entry.data.length, httpEtag:'"test-etag"'} : null;},
      async delete(keys) {for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);}
    },
    RENDERER:{getByName(name) {
      state.slots.push(name);
      return {async fetch(request) {
        const url = new URL(request.url); calls.push({method:request.method, path:url.pathname});
        if (url.pathname === '/render') {
          const input = await request.json();
          assert.equal(Number(request.headers.get('Content-Length')), new TextEncoder().encode(JSON.stringify(input)).length);
          if (state.renderGate) await state.renderGate;
          if (state.renderGates.has(input.id)) await state.renderGates.get(input.id);
          const status = state.renderStatuses.get(input.id) ?? state.renderStatus;
          if (status !== 200) return new Response('busy or failed', {status});
          if (!cached.has(input.id)) {
            state.workCount++;
            cached.set(input.id, {id:input.id, status:'ready', params:{cards:input.cards, seed:input.seed, m:Math.min(...input.cards), n:Math.max(...input.cards), a:.6, b:.8}, rarity:{tier:'gold'}, story:{title:'共生'}, generator:'local_garden', particle_count:2400});
          }
          const manifest = structuredClone(cached.get(input.id));
          if (state.corruptManifest) manifest.params.seed++;
          return Response.json(manifest);
        }
        if (request.method === 'DELETE') {cached.delete(url.pathname.split('/').at(-1)); return Response.json({ok:true});}
        const name = url.pathname.split('/').at(-1);
        if (!FILES.includes(name)) return new Response(null, {status:404});
        const bytes = new TextEncoder().encode(`real-renderer-file:${name}`);
        return new Response(bytes, {headers:{'Content-Length':String(bytes.length + state.artifactSizeDelta)}});
      }};
    }}
  };
  return {env, state, objects, queued, calls, cached};
}

function request(path, options = {}) {return new Request(`${ORIGIN}${path}`, options);}
function post(input, headers = {}) {return request('/api/jobs', {method:'POST', headers:{'Content-Type':'application/json', ...headers}, body:JSON.stringify(input)});}
const input = (cards = [1,12]) => ({cards, request_id:crypto.randomUUID()});
async function create(env, data = input()) {
  const response = await worker.fetchHandler(post(data), env);
  assert.equal(response.status, 201); return response.json();
}
const row = (env, id) => env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();
const update = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
function message(id) {return {body:{id}, acked:false, retryDelay:null, ack(){assert.equal(this.retryDelay, null); this.acked = true;}, retry({delaySeconds}){assert.equal(this.acked, false); this.retryDelay = delaySeconds;}};}
async function consume(env, id) {const item = message(id); await worker.queueHandler({messages:[item]}, env); return item;}

test('validates JSON, byte limit, cards, high-entropy key, content type and Origin', async t => {
  const {env} = bindings(t);
  for (const data of [null, [], {}, input([1,1]), input([0,12]), input([1,13]), input(['1',2]), input([1]), {...input(), extra:true}, {...input(), request_id:'guessable'}]) {
    assert.equal((await worker.fetchHandler(post(data), env)).status, 400);
  }
  assert.equal((await worker.fetchHandler(request('/api/jobs', {method:'POST', body:'{}'}), env)).status, 415);
  assert.equal((await worker.fetchHandler(request('/api/jobs', {method:'POST', body:'{', headers:{'Content-Type':'application/json'}}), env)).status, 400);
  assert.equal((await worker.fetchHandler(post(input(), {Origin:'https://other.example'}), env)).status, 403);
  assert.equal((await worker.fetchHandler(post(input(), {Origin:ORIGIN}), env)).status, 201);
  const stream = new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4097)); controller.close();}});
  assert.equal((await worker.fetchHandler(request('/api/jobs', {method:'POST', headers:{'Content-Type':'application/json'}, body:stream, duplex:'half'}), env)).status, 413);
  assert.equal((await worker.fetchHandler(post(input(), {'Content-Length':'5000'}), env)).status, 413);
});

test('200 independent submissions are durable and get unique high-entropy job IDs', async t => {
  const {env, queued, calls} = bindings(t);
  const jobs = await Promise.all(Array.from({length:200}, () => create(env)));
  assert.equal(new Set(jobs.map(job => job.id)).size, 200);
  assert.equal(queued.length, 200); assert.equal(calls.length, 0);
  for (const job of jobs) {
    assert.match(job.id, /^SG-\d{8}-\d{1,29}-[A-F0-9]{8}$/);
    assert.equal(job.status, 'queued'); assert.deepEqual((await row(env, job.id)).status, 'queued');
  }
});

test('same request_id is idempotent under concurrent POSTs and rejects changed ordered cards', async t => {
  const {env} = bindings(t), data = input();
  const responses = await Promise.all(Array.from({length:30}, () => worker.fetchHandler(post(data), env)));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 200).length, 29);
  assert.equal(new Set((await Promise.all(responses.map(response => response.json()))).map(job => job.id)).size, 1);
  assert.equal((await worker.fetchHandler(post({...data, cards:[12,1]}), env)).status, 409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM jobs').first()).count, 1);
});

test('512 pending jobs are an atomic ceiling while existing keys and completed slots remain usable', async t => {
  const {env, queued} = bindings(t), firstInput = input(), first = await create(env, firstInput);
  await update(env, "UPDATE jobs SET status='generating' WHERE id=?", first.id);
  const overflowInput = input();
  const responses = await Promise.all(Array.from({length:520}, () => worker.fetchHandler(post(input()), env)));
  assert.equal(responses.filter(response => response.status === 201).length, 511);
  assert.equal(responses.filter(response => response.status === 429).length, 9);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM jobs').first()).count, 512);
  assert.equal(queued.length, 512);
  const full = await worker.fetchHandler(post(overflowInput), env);
  assert.equal(full.status, 429); assert.equal(full.headers.get('Retry-After'), '30');
  assert.equal((await full.json()).retry_after, 30);
  const repeated = await worker.fetchHandler(post(firstInput), env);
  assert.equal(repeated.status, 200); assert.equal((await repeated.json()).id, first.id);
  assert.equal((await worker.fetchHandler(post({...firstInput, cards:[12,1]}), env)).status, 409);
  await update(env, "UPDATE jobs SET status='failed' WHERE id=?", first.id);
  const released = await create(env, overflowInput);
  assert.equal(released.status, 'queued'); assert.equal(queued.length, 513);
});

test('crypto hex fallback, ordered cards and the full uint32 seed range reach the renderer unchanged', async t => {
  const {env} = bindings(t);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const request_id = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  for (const seed of [0, 0x80000000, 0xffffffff]) {
    const job = await create(env, {cards:[12,1], request_id:seed === 0 ? request_id : crypto.randomUUID()});
    await update(env, 'UPDATE jobs SET seed=? WHERE id=?', seed, job.id);
    await consume(env, job.id);
    const result = await (await worker.fetchHandler(request(`/api/jobs/${job.id}`), env)).json();
    assert.equal(result.status, 'ready'); assert.deepEqual(result.params.cards, [12,1]);
    assert.equal(result.params.seed, seed); assert.equal(result.params.seed >>> 0, seed);
    assert.equal(result.params.m, 1); assert.equal(result.params.n, 12);
  }
});

test('publishes ready only after four R2 uploads; artifacts GET/HEAD retain correct types', {timeout:3000}, async t => {
  const {env, objects, calls, state} = bindings(t), job = await create(env);
  assert.equal((await worker.fetchHandler(request(`/printer/jobs/${job.id}/artwork.webp`), env)).status, 404);
  let release; state.putGates.set('artwork.pdf', new Promise(resolve => {release = resolve;}));
  t.after(() => release());
  const pending = consume(env, job.id);
  while (objects.size !== 3) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await row(env, job.id)).status, 'generating');
  assert.ok((await row(env, job.id)).lease_until > Date.now());
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
  assert.equal((await worker.fetchHandler(request(`/printer/jobs/${job.id}/artwork.webp`), env)).status, 404);
  release(); assert.equal((await pending).acked, true);
  assert.equal(objects.size, 4); assert.equal(state.workCount, 1);
  const manifest = await (await worker.fetchHandler(request(`/api/jobs/${job.id}`), env)).json();
  assert.equal(manifest.status, 'ready'); assert.deepEqual(manifest.params.cards, [1,12]);
  assert.deepEqual(manifest.story, {title:'共生'}); assert.deepEqual(manifest.rarity, {tier:'gold'});
  assert.equal(manifest.image, `/printer/jobs/${job.id}/artwork.webp`);
  assert.equal(manifest.print_status, 'not_submitted'); assert.equal(manifest.request_id, undefined);
  const get = await worker.fetchHandler(request(manifest.image), env);
  assert.equal(get.headers.get('Content-Type'), 'image/webp'); assert.equal(await get.text(), 'real-renderer-file:artwork.webp');
  const head = await worker.fetchHandler(request(manifest.pdf, {method:'HEAD'}), env);
  assert.equal(head.status, 200); assert.equal(head.body, null); assert.equal(head.headers.get('Content-Type'), 'application/pdf');
  assert.match(head.headers.get('Content-Disposition'), /attachment/);
  assert.equal(calls.at(-1).method, 'DELETE'); assert.equal((await row(env, job.id)).lease_token, null);
  await consume(env, job.id); assert.equal(state.workCount, 1);
});

test('partial R2 upload stays unpublished and retries cached rendering with identical identity', async t => {
  const {env, objects, state} = bindings(t), job = await create(env);
  state.failPut = 'artwork.pdf';
  const first = await consume(env, job.id);
  assert.equal(first.acked, false); assert.ok(first.retryDelay > 0);
  assert.equal(objects.size, 3); assert.equal((await row(env, job.id)).status, 'queued');
  assert.equal((await worker.fetchHandler(request(`/printer/jobs/${job.id}/artwork.png`), env)).status, 404);
  state.failPut = null;
  assert.equal((await consume(env, job.id)).acked, true);
  assert.equal((await row(env, job.id)).status, 'ready'); assert.equal(objects.size, 4);
  assert.equal(state.workCount, 1); assert.equal(new Set(state.slots).size, 1);
});

test('two concurrent uploads settle before ready or terminal cleanup; no late object survives failure', {timeout:3000}, async t => {
  const {env, objects, state, calls} = bindings(t), job = await create(env);
  await update(env, 'UPDATE jobs SET attempts=4 WHERE id=?', job.id);
  let release; state.putGates.set('particles.json', new Promise(resolve => {release = resolve;}));
  t.after(() => release());
  state.failPut = 'artwork.pdf';
  const pending = consume(env, job.id);
  while (!calls.some(call => call.path.endsWith('/particles.json'))) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await row(env, job.id)).status, 'generating');
  assert.ok((await row(env, job.id)).lease_token);
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
  assert.equal((await worker.fetchHandler(request(`/printer/jobs/${job.id}/artwork.png`), env)).status, 404);
  release();
  assert.equal((await pending).acked, true);
  assert.equal(state.maxPuts, 2); assert.equal(state.activePuts, 0);
  assert.equal((await row(env, job.id)).status, 'failed');
  assert.equal(objects.size, 0); assert.equal(calls.at(-1).method, 'DELETE');
});

test('streaming R2 upload rejects truncated or oversized artifacts and can retry', {timeout:3000}, async t => {
  const {env, state, objects} = bindings(t), job = await create(env);
  for (const delta of [1, -1]) {
    state.artifactSizeDelta = delta;
    assert.ok((await consume(env, job.id)).retryDelay > 0);
    assert.equal((await row(env, job.id)).status, 'queued');
    assert.equal(objects.size, 0);
  }
  state.artifactSizeDelta = 0;
  assert.equal((await consume(env, job.id)).acked, true);
  assert.equal((await row(env, job.id)).status, 'ready');
  assert.equal(state.workCount, 1);
});

test('timing and failure logs never expose job or request capability identifiers', async t => {
  const logs = [];
  t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  t.mock.method(console, 'error', value => logs.push(JSON.parse(value)));
  const {env} = bindings(t), data = input(), job = await create(env, data);
  const put = env.ARTWORKS.put;
  env.ARTWORKS.put = async () => {throw Error(`Upload failed ${job.id} ${data.request_id}`);};
  await consume(env, job.id);
  assert.equal(logs[0].event, 'artwork_attempt_failed');
  assert.match(logs[0].error, /\[job\].*\[token\]/);
  env.ARTWORKS.put = put;
  await consume(env, job.id);
  const ready = logs.find(log => log.event === 'artwork_ready');
  assert.ok(ready); assert.ok(ready.render_ms >= 0); assert.ok(ready.uploads_ms >= 0);
  assert.equal(Object.keys(ready.files).length, 4);
  assert.ok(!JSON.stringify(logs).includes(job.id));
  assert.ok(!JSON.stringify(logs).includes(data.request_id));
});

test('CAS lease prevents simultaneous duplicate deliveries from rendering twice', async t => {
  const {env, state, calls} = bindings(t), job = await create(env);
  let release; state.renderGate = new Promise(resolve => {release = resolve;});
  const owner = consume(env, job.id);
  while (!calls.length) await new Promise(resolve => setImmediate(resolve));
  const duplicate = await consume(env, job.id);
  assert.equal(duplicate.acked, true); assert.equal(calls.length, 1);
  release(); assert.equal((await owner).acked, true);
  assert.equal(state.workCount, 1); assert.equal((await row(env, job.id)).attempts, 1);
});

test('queue runs two messages concurrently and waits for both before a third', {timeout:3000}, async t => {
  const {env, state, calls} = bindings(t), jobs = await Promise.all([create(env), create(env), create(env)]);
  const releases = [];
  for (const job of jobs.slice(0, 2)) state.renderGates.set(job.id, new Promise(resolve => releases.push(resolve)));
  t.after(() => releases.forEach(release => release()));
  const messages = jobs.map(job => message(job.id)), pending = worker.queueHandler({messages}, env);
  while (calls.filter(call => call.path === '/render').length !== 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await row(env, jobs[0].id)).status, 'generating');
  assert.equal((await row(env, jobs[1].id)).status, 'generating');
  assert.equal((await row(env, jobs[2].id)).status, 'queued');
  releases[0]();
  while ((await row(env, jobs[0].id)).status !== 'ready') await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.path === '/render').length, 2);
  releases[1](); await pending;
  assert.ok(messages.every(message => message.acked));
  for (const job of jobs) assert.equal((await row(env, job.id)).status, 'ready');
  assert.equal(state.workCount, 3);
});

test('one failed queue message does not stop its batch peer from finishing', async t => {
  const {env, state} = bindings(t), failed = await create(env), successful = await create(env);
  state.renderStatuses.set(failed.id, 500);
  const messages = [message(failed.id), message(successful.id)];
  await worker.queueHandler({messages}, env);
  assert.ok(messages[0].retryDelay > 0); assert.equal(messages[0].acked, false);
  assert.equal(messages[1].acked, true);
  assert.equal((await row(env, failed.id)).status, 'queued');
  assert.equal((await row(env, successful.id)).status, 'ready');
});

test('duplicate job messages in the same parallel batch share one CAS owner', async t => {
  const {env, state} = bindings(t), job = await create(env);
  const messages = [message(job.id), message(job.id)];
  await worker.queueHandler({messages}, env);
  assert.ok(messages.every(message => message.acked));
  assert.equal(state.workCount, 1); assert.equal((await row(env, job.id)).attempts, 1);
  assert.equal((await row(env, job.id)).status, 'ready');
});

test('busy slot defers without using a generation attempt or exposing failure', async t => {
  const {env, state} = bindings(t), job = await create(env);
  state.renderStatus = 429;
  for (let i = 0; i < 8; i++) {
    const item = await consume(env, job.id); assert.equal(item.acked, false); assert.ok(item.retryDelay >= 5);
  }
  const stored = await row(env, job.id);
  assert.equal(stored.status, 'queued'); assert.equal(stored.attempts, 0); assert.equal(stored.error, null);
  state.renderStatus = 200; await consume(env, job.id);
  assert.equal((await row(env, job.id)).status, 'ready');
});

test('invalid renderer manifest fails finitely and never publishes mismatched artwork', async t => {
  const {env, state, objects} = bindings(t), job = await create(env);
  state.corruptManifest = true;
  for (let i = 0; i < 5; i++) {
    const item = await consume(env, job.id);
    assert.equal(item.acked, i === 4);
    assert.equal((await row(env, job.id)).status, i === 4 ? 'failed' : 'queued');
  }
  assert.equal(objects.size, 0);
  const result = await (await worker.fetchHandler(request(`/api/jobs/${job.id}`), env)).json();
  assert.equal(result.status, 'failed'); assert.ok(result.error);
  assert.equal((await consume(env, job.id)).acked, true);
});

test('D1 durable outbox recovers queue send interruption without losing idempotency', async t => {
  const {env, state, queued} = bindings(t), data = input();
  state.queueFailure = true;
  const response = await worker.fetchHandler(post(data), env); assert.equal(response.status, 503);
  const {id} = await response.json(); assert.equal((await row(env, id)).status, 'queued');
  state.queueFailure = false;
  await worker.scheduledHandler({}, env);
  assert.deepEqual(queued, [{id}]); assert.ok((await row(env, id)).enqueued_at);
  const replay = await worker.fetchHandler(post(data), env); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, id); assert.equal(queued.length, 1);
  await consume(env, id); assert.equal((await row(env, id)).status, 'ready');
});

test('cron requeues crashed expired leases and never steals a live lease', async t => {
  const {env, queued} = bindings(t), expired = await create(env), live = await create(env);
  queued.length = 0;
  await update(env, "UPDATE jobs SET status='generating',lease_token='crashed',lease_until=?,attempts=1 WHERE id=?", Date.now() - 1, expired.id);
  await update(env, "UPDATE jobs SET status='generating',lease_token='active',lease_until=?,attempts=1 WHERE id=?", Date.now() + 60000, live.id);
  await worker.scheduledHandler({}, env); assert.deepEqual(queued, [{id:expired.id}]);
  await consume(env, expired.id); assert.equal((await row(env, expired.id)).status, 'ready');
  await consume(env, live.id); assert.equal((await row(env, live.id)).lease_token, 'active');
});

test('jobs waiting over 30 minutes terminate visibly and clean partial files', async t => {
  const {env, calls, objects} = bindings(t), job = await create(env);
  objects.set(`${job.id}/artwork.png`, {data:new Uint8Array([1])});
  await update(env, 'UPDATE jobs SET created_at=? WHERE id=?', Date.now() - 1800001, job.id);
  assert.equal((await consume(env, job.id)).acked, true);
  assert.equal((await row(env, job.id)).status, 'failed'); assert.equal(objects.size, 0);
  assert.deepEqual(calls.map(call => call.method), ['DELETE']);
});

test('health is read-only; unknown paths and physical print operations are unavailable', async t => {
  const {env, queued} = bindings(t);
  const response = await worker.fetchHandler(request('/api/health'), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).max_concurrent_renders, 20);
  for (const path of ['/api/jobs/guessable','/api/print','/printer/jobs/../../secret','/api/session']) {
    assert.equal((await worker.fetchHandler(request(path), env)).status, 404);
  }
  assert.equal((await worker.fetchHandler(request('/api/jobs'), env)).status, 405);
  assert.equal(queued.length, 0);
  assert.equal(new Set(Array.from({length:500}, (_, i) => worker.slotFor(String(i)))).size, 20);
});
