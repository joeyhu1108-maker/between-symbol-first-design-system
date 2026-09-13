import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const PUBLIC = 'https://between.example';
const UPSTREAM = 'https://legacy.example';
const ID = 'SG-20260913-12345-A1B2C3D4';
const JOB = `/api/jobs/${ID}`;
const FILES = ['artwork.png', 'artwork.webp', 'artwork.pdf', 'particles.json'];
const artifact = name => `/printer/jobs/${ID}/${name}`;
const request = (path, method = 'GET', headers = {}) => new Request(PUBLIC + path, {
  method, headers, ...(method === 'POST' ? {body:'{"cards":[1,2],"request_id":"same-id"}'} : {})
});

function setup(t, cloud = () => Response.json({source:'cloud'})) {
  const calls = {cloud:[], legacy:[], assets:[]}, stored = new Map(), pending = [];
  const previousCaches = globalThis.caches;
  globalThis.caches = {default:{
    async match(key) {return stored.get(key.url)?.clone();},
    async put(key, response) {stored.set(key.url, response);}
  }};
  t.after(async () => {
    await Promise.all(pending);
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  });
  const state = {legacy:() => Response.json({source:'legacy', url:UPSTREAM + '/tap'})};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.legacy.push({url:String(url), ...options});
    return state.legacy(url, options);
  });
  const env = {
    UPSTREAM,
    ASSETS:{async fetch(req) {calls.assets.push(req); return new Response('static');}},
    ARTWORK_BACKEND:{async fetch(req) {calls.cloud.push(req); return cloud(req);}}
  };
  const ctx = {waitUntil(promise) {pending.push(promise);}};
  return {env, calls, state, stored, run:req => worker.fetch(req, env, ctx)};
}

test('only the exact cloud route and method combinations use the binding', async t => {
  const h = setup(t);
  const routes = [['/api/health','GET'], ['/api/health','HEAD'], ['/api/jobs','POST'], [JOB,'GET'], [JOB,'HEAD'],
    ...FILES.flatMap(name => [[artifact(name),'GET'], [artifact(name),'HEAD']])];
  for (const [path, method] of routes) {
    assert.equal((await h.run(request(path, method))).status, 200);
  }
  assert.equal(h.calls.cloud.length, routes.length);
  assert.equal(h.calls.legacy.length, 0);
  assert.equal(h.calls.assets.length, 0);
});

test('service binding receives the original URL, Origin, headers and body', async t => {
  const payload = '{"cards":[12,1],"request_id":"keep-this-id"}';
  const req = new Request(PUBLIC + '/api/jobs?client=phone', {method:'POST', headers:{
    Origin:PUBLIC, 'Content-Type':'application/json', 'X-Custom':'unchanged'
  }, body:payload});
  const response = Response.json({id:ID}, {status:201, headers:{'Cache-Control':'no-store'}});
  const h = setup(t, async received => {
    assert.equal(received, req);
    assert.equal(received.url, req.url);
    assert.equal(received.headers.get('Origin'), PUBLIC);
    assert.equal(received.headers.get('X-Custom'), 'unchanged');
    assert.equal(received.headers.has('X-Between-Public-Origin'), false);
    assert.equal(await received.text(), payload);
    return response;
  });
  assert.equal(await h.run(req), response);
  assert.equal(h.calls.legacy.length, 0);
});

test('requests without Origin and cloud artifact response headers stay unchanged', async t => {
  const h = setup(t, req => {
    assert.equal(req.headers.has('Origin'), false);
    return new Response('file bytes', {headers:{'Content-Type':'application/pdf',
      'Cache-Control':'private, max-age=86400', ETag:'"original"'}});
  });
  const response = await h.run(request(artifact('artwork.pdf')));
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=86400');
  assert.equal(response.headers.get('ETag'), '"original"');
  assert.equal(await response.text(), 'file bytes');
  assert.equal(h.stored.size, 0);
});

test('only cloud 404 permits old job and four artifact reads to fall back', async t => {
  let canceled = 0;
  const h = setup(t, () => new Response(new ReadableStream({cancel() {canceled++;}}), {status:404}));
  for (const path of [JOB, ...FILES.map(artifact)]) {
    for (const method of ['GET','HEAD']) {
      const response = await h.run(request(path + '?download=1', method, {Origin:PUBLIC}));
      assert.equal(response.status, 200);
      const forwarded = h.calls.legacy.at(-1);
      assert.equal(forwarded.url, UPSTREAM + path + '?download=1');
      assert.equal(forwarded.method, method);
      assert.equal(forwarded.headers.get('Origin'), UPSTREAM);
      assert.equal(forwarded.headers.get('X-Between-Public-Origin'), PUBLIC);
    }
  }
  assert.equal(canceled, 10);
  assert.equal(h.calls.legacy.length, 10);
  assert.equal(h.calls.assets.length, 0);
});

test('health and creation never fall back even when cloud returns 404', async t => {
  const h = setup(t, () => Response.json({error:'not found'}, {status:404}));
  for (const [path, method] of [['/api/health','GET'], ['/api/health','HEAD'], ['/api/jobs','POST']]) {
    assert.equal((await h.run(request(path, method))).status, 404);
  }
  assert.equal(h.calls.legacy.length, 0);
});

test('non-404 cloud errors retain status and Retry-After without legacy fallback', async t => {
  let status = 403;
  const h = setup(t, () => Response.json({error:'cloud unavailable'}, {status, headers:{'Retry-After':'7'}}));
  for (status of [403, 429, 500, 503]) {
    for (const [path, method] of [['/api/health','GET'], ['/api/jobs','POST'], [JOB,'GET'], [JOB,'HEAD'], [artifact('artwork.webp'),'GET'], [artifact('artwork.pdf'),'HEAD']]) {
      const response = await h.run(request(path, method));
      assert.equal(response.status, status);
      assert.equal(response.headers.get('Retry-After'), '7');
    }
  }
  assert.equal(h.calls.legacy.length, 0);
});

test('binding network failure returns JSON 503 and does not recreate jobs in legacy', async t => {
  const h = setup(t, async req => {if (req.method === 'POST') await req.text(); throw Error('offline');});
  for (const [path, method] of [['/api/health','GET'], ['/api/jobs','POST'], [JOB,'GET'], [artifact('artwork.pdf'),'GET']]) {
    const response = await h.run(request(path, method));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    assert.ok((await response.json()).error);
  }
  assert.equal(h.calls.legacy.length, 0);
  assert.equal(h.calls.assets.length, 0);
});

test('NFC, sessions, printing and non-whitelisted routes retain legacy routing', async t => {
  const h = setup(t);
  const routes = [['/api/entry-sessions','POST'], ['/api/entry-sessions/abc','GET'], ['/api/nfc/tap','POST'],
    ['/api/print-jobs','POST'], [`${JOB}/print`,'POST'], ['/nfc-print-agent.py','GET'],
    [artifact('guide.png'),'GET'], [artifact('artwork.png') + '/extra','GET'],
    ['/api/jobs/not-an-id','GET'], [JOB,'POST'], ['/api/health','POST'], ['/api/jobs','GET']];
  for (const [path, method] of routes) assert.equal((await h.run(request(path, method))).status, 200);
  assert.equal(h.calls.cloud.length, 0);
  assert.equal(h.calls.legacy.length, routes.length);
  assert.equal(h.calls.assets.length, 0);
});

test('absent binding leaves the old health, job creation and artifact routes operational', async t => {
  const h = setup(t); delete h.env.ARTWORK_BACKEND;
  for (const [path, method] of [['/api/health','GET'], ['/api/jobs','POST'], [JOB,'GET'], [artifact('artwork.pdf'),'GET']]) {
    const response = await h.run(request(path, method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, PUBLIC + '/tap');
  }
  assert.equal(h.calls.legacy.length, 4);
  assert.equal(h.calls.cloud.length, 0);
});

test('static asset aliases remain untouched', async t => {
  const h = setup(t);
  for (const [path, target] of [['/','/prototype-3d.html'], ['/scene','/prototype-3d.html'],
    ['/tap','/nfc-tap.html'], ['/printer/','/printer/index.html'], ['/prototype-3d.js','/prototype-3d.js']]) {
    assert.equal(await (await h.run(request(path + '?v=keep'))).text(), 'static');
    assert.equal(h.calls.assets.at(-1).url, PUBLIC + target + '?v=keep');
  }
  assert.equal(h.calls.cloud.length + h.calls.legacy.length, 0);
});

test('cross-origin requests are rejected before either backend or artifact cache', async t => {
  const h = setup(t);
  h.stored.set(PUBLIC + artifact('artwork.pdf'), new Response('cached'));
  for (const [path, method] of [['/api/health','GET'], ['/api/jobs','POST'], [JOB,'GET'],
    [artifact('artwork.pdf'),'GET'], ['/api/nfc/tap','POST']]) {
    const response = await h.run(request(path, method, {Origin:'https://other.example'}));
    assert.equal(response.status, 403);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
  }
  assert.equal(h.calls.cloud.length + h.calls.legacy.length + h.calls.assets.length, 0);
});

test('HTTP is redirected to HTTPS before any routing, preserving path and query', async t => {
  const h = setup(t);
  for (const path of ['/', '/api/health', JOB, artifact('artwork.pdf'), '/tap']) {
    const response = await h.run(new Request('http://between.example' + path + '?v=1'));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), PUBLIC + path + '?v=1');
  }
  assert.equal(h.calls.cloud.length + h.calls.legacy.length + h.calls.assets.length, 0);
});

test('HTML and XHTML error pages cannot masquerade as successful API responses', async t => {
  let status = 200, type = 'text/html';
  const html = () => new Response('<html>upstream page</html>', {status, headers:{'Content-Type':type}});
  const h = setup(t, html); h.state.legacy = html;
  for (status of [200, 502]) {
    for (type of ['text/html; charset=utf-8','Application/XHTML+XML']) {
      for (const path of ['/api/health', '/api/nfc/status']) {
        const response = await h.run(request(path));
        assert.equal(response.status, 503);
        assert.match(response.headers.get('Content-Type'), /application\/json/);
        assert.ok((await response.json()).error);
      }
    }
  }
  assert.equal(h.calls.assets.length, 0);
});

test('old artifact cache is consulted only after a cloud 404, never during outage', async t => {
  let status = 200;
  const h = setup(t, () => new Response('cloud', {status}));
  const path = artifact('artwork.webp');
  h.stored.set(PUBLIC + path, new Response('old cached file'));
  assert.equal(await (await h.run(request(path))).text(), 'cloud');
  status = 503;
  assert.equal((await h.run(request(path))).status, 503);
  status = 404;
  assert.equal(await (await h.run(request(path))).text(), 'old cached file');
  assert.equal(h.calls.cloud.length, 3);
  assert.equal(h.calls.legacy.length, 0);
});

test('unsupported HTTP methods retain the existing 405 gate', async t => {
  const h = setup(t);
  for (const method of ['OPTIONS','PUT','DELETE']) {
    assert.equal((await h.run(new Request(PUBLIC + JOB, {method}))).status, 405);
  }
  assert.equal(h.calls.cloud.length + h.calls.legacy.length, 0);
});
