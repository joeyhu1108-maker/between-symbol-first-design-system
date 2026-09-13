import {Container} from '@cloudflare/containers';

export class ArtworkRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = '60s';
}

const SLOT_COUNT = 20, MAX_PENDING = 512, MAX_ATTEMPTS = 5, LEASE_MS = 360000, MAX_AGE_MS = 1800000;
const ID = 'SG-[0-9]{8}-[0-9]{1,40}-[A-F0-9]{8}';
const FILES = {'artwork.png':'image/png', 'artwork.webp':'image/webp', 'artwork.pdf':'application/pdf', 'particles.json':'application/json'};
const jobPath = new RegExp(`^/api/jobs/(${ID})$`);
const filePath = new RegExp(`^/printer/jobs/(${ID})/(artwork\\.(?:png|webp|pdf)|particles\\.json)$`);
const json = (value, status = 200, headers = {}) => Response.json(value, {status, headers:{'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers}});
const dbRun = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const rowById = (env, id) => env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
const objectKey = (id, name) => `${id}/${name}`;
const safeError = error => String(error?.message || error).replace(new RegExp(ID, 'g'), '[job]').replace(/\b(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})\b/gi, '[token]').slice(0, 400);

function publicJob(row) {
  const result = row.manifest_json ? JSON.parse(row.manifest_json) : {
    id:row.id, params:{cards:JSON.parse(row.cards_json), seed:row.seed},
    created_at:new Date(row.created_at).toISOString(), generator:'local_garden', print_status:'not_submitted'
  };
  return {...result, id:row.id, status:row.status, ...(row.error ? {error:row.error} : {})};
}

async function readJSON(request, maximum = 4096) {
  if (!request.body) throw Object.assign(Error('请提供 JSON 请求。'), {status:400});
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > maximum) throw Object.assign(Error('请求内容过大。'), {status:413});
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) {await reader.cancel(); throw Object.assign(Error('请求内容过大。'), {status:413});}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));}
  catch {throw Object.assign(Error('JSON 格式无效。'), {status:400});}
}

function validateInput(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !['cards','request_id'].includes(key))) return false;
  const {cards, request_id:key} = value;
  return Array.isArray(cards) && cards.length === 2 && cards.every(card => Number.isInteger(card) && card >= 1 && card <= 12) && cards[0] !== cards[1]
    && typeof key === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(key);
}

function newIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, value => value.toString(16).padStart(2,'0')).join('');
  const date = new Date().toISOString().slice(0,10).replaceAll('-','');
  return {id:`SG-${date}-${BigInt(`0x${hex.slice(0,24)}`)}-${hex.slice(24).toUpperCase()}`, seed:crypto.getRandomValues(new Uint32Array(1))[0]};
}

async function createJob(request, env) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return json({error:'请使用 application/json。'}, 415);
  const input = await readJSON(request);
  if (!validateInput(input)) return json({error:'需要两张不同的 1–12 号卡，以及随机 UUID v4 或 32 位十六进制 request_id。'}, 400);
  const now = Date.now(), identity = newIdentity(), cards = JSON.stringify(input.cards);
  // The count and insert share one atomic D1 statement; concurrent submissions
  // cannot oversubscribe the bounded queue. Existing keys remain retrievable.
  const inserted = await dbRun(env, `INSERT INTO jobs (id,request_id,cards_json,seed,status,created_at,updated_at)
    SELECT ?,?,?,?,'queued',?,? WHERE (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','generating'))<?
    ON CONFLICT(request_id) DO NOTHING`, identity.id, input.request_id, cards, identity.seed, now, now, MAX_PENDING);
  const row = await env.DB.prepare('SELECT * FROM jobs WHERE request_id = ?').bind(input.request_id).first();
  if (!row) return json({error:'当前参与人数较多，请稍后用相同编号重试。', retry_after:30}, 429, {'Retry-After':'30'});
  if (row.cards_json !== cards) return json({error:'这个 request_id 已绑定其他卡片，请为新的创作使用新的编号。'}, 409);
  // D1 is the durable outbox. The scheduled handler repairs interruption before/after Queue.send.
  if (row.status === 'queued' && (!row.enqueued_at || inserted.meta.changes)) {
    try {
      await env.GENERATION_QUEUE.send({id:row.id});
      await dbRun(env, 'UPDATE jobs SET enqueued_at = ? WHERE id = ?', Date.now(), row.id);
    } catch {return json({error:'作品已保存，正在恢复排队。请用相同 request_id 重试。', id:row.id, status:'queued'}, 503, {'Retry-After':'3'});}
  }
  return json(publicJob(row), inserted.meta.changes ? 201 : 200);
}

async function serveFile(request, env, id, name) {
  const row = await rowById(env, id);
  if (!row || row.status !== 'ready') return json({error:'作品文件尚未准备好。'}, 404);
  const object = await env.ARTWORKS[request.method === 'HEAD' ? 'head' : 'get'](objectKey(id, name));
  if (!object) return json({error:'作品文件暂时不可用，请稍后重试。'}, 503, {'Retry-After':'3'});
  const headers = new Headers({'Content-Type':FILES[name], 'Content-Length':String(object.size), 'Cache-Control':'private, max-age=86400', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (name === 'artwork.pdf') headers.set('Content-Disposition', `attachment; filename="${id}.pdf"`);
  return new Response(request.method === 'HEAD' ? null : object.body, {headers});
}

export async function fetchHandler(request, env) {
  const url = new URL(request.url);
  if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return json({error:'请求来源不匹配。'}, 403);
  try {
    if (url.pathname === '/api/health' && ['GET','HEAD'].includes(request.method)) {
      await env.DB.prepare('SELECT 1 AS ok').first();
      const ok = !!(env.ARTWORKS && env.GENERATION_QUEUE && env.RENDERER);
      return json({ok, generator:'local_garden', backend:'cloudflare', ai_image_provider:false, max_concurrent_renders:SLOT_COUNT}, ok ? 200 : 503);
    }
    if (url.pathname === '/api/jobs') return request.method === 'POST' ? await createJob(request, env) : json({error:'不支持这个请求方法。'}, 405, {Allow:'POST'});
    const job = url.pathname.match(jobPath), file = url.pathname.match(filePath);
    if ((job || file) && !['GET','HEAD'].includes(request.method)) return json({error:'不支持这个请求方法。'}, 405, {Allow:'GET, HEAD'});
    if (job) {
      const row = await rowById(env, job[1]);
      return row ? json(publicJob(row)) : json({error:'没有找到这件作品。'}, 404);
    }
    if (file) return await serveFile(request, env, file[1], file[2]);
    return json({error:'没有这个接口。'}, 404);
  } catch (error) {return json({error:error.status ? error.message : '作品服务暂时不可用，请稍后重试。'}, error.status || 503, {'Retry-After':'3'});}
}

export function slotFor(id) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `renderer-${hash % SLOT_COUNT}`;
}
const rendererFor = (env, id) => env.RENDERER.getByName(slotFor(id));
const delayFor = attempts => Math.min(60, 3 * 2 ** Math.min(attempts, 4));

async function cleanContainer(renderer, id) {
  try {await renderer.fetch(new Request(`http://renderer/files/${id}`, {method:'DELETE', signal:AbortSignal.timeout(10000)}));} catch {}
}

function readyManifest(manifest, row) {
  const p = manifest?.params, cards = JSON.parse(row.cards_json);
  if (manifest?.status !== 'ready' || manifest.id !== row.id || p?.seed !== row.seed || JSON.stringify(p?.cards) !== row.cards_json || p?.m !== Math.min(...cards) || p?.n !== Math.max(...cards) || !Number.isFinite(p.a) || !Number.isFinite(p.b)) throw Error('Invalid renderer manifest');
  const result = {};
  for (const key of ['params','rarity','story','generator','style_version','style_scale','particle_count','ready_at']) if (manifest[key] !== undefined) result[key] = manifest[key];
  return {...result, id:row.id, status:'ready', created_at:new Date(row.created_at).toISOString(), print_status:'not_submitted', image:`/printer/jobs/${row.id}/artwork.webp`, pdf:`/printer/jobs/${row.id}/artwork.pdf`, particles:`/printer/jobs/${row.id}/particles.json`};
}

async function uploadArtifact(env, id, name, contentType, file, size) {
  // Container RPC returns a stream without workerd's known-length marker.
  // Re-establish it without buffering the image in the Worker isolate.
  const {readable, writable} = new FixedLengthStream(size);
  const controller = new AbortController();
  const transfers = [
    file.body.pipeTo(writable, {signal:controller.signal}),
    env.ARTWORKS.put(objectKey(id, name), readable, {httpMetadata:{contentType}, customMetadata:{job:id}})
  ];
  try {await Promise.all(transfers);}
  catch (error) {
    controller.abort(error);
    // If put rejected before taking a reader, release the backpressured pipe.
    await readable.cancel(error).catch(() => {});
    await Promise.allSettled(transfers);
    throw error;
  }
}

async function processMessage(message, env) {
  const id = message.body?.id;
  if (typeof id !== 'string' || !new RegExp(`^${ID}$`).test(id)) {message.ack(); return;}
  const row = await rowById(env, id), now = Date.now();
  if (!row || ['ready','failed'].includes(row.status)) {message.ack(); return;}
  // An active owner will finish or expire; cron recovers an expired lease even after a crash.
  if (row.lease_until > now) {message.ack(); return;}
  if (row.attempts >= MAX_ATTEMPTS || now - row.created_at > MAX_AGE_MS) {
    const changed = await dbRun(env, `UPDATE jobs SET status='failed',error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','generating') AND (lease_until IS NULL OR lease_until<=?)`, '作品生成未能完成，请重新开始。', now, id, now);
    if (changed.meta.changes) {
      try {await env.ARTWORKS.delete(Object.keys(FILES).map(name => objectKey(id, name)));} catch {}
      try {await cleanContainer(rendererFor(env, id), id);} catch {}
    }
    message.ack(); return;
  }
  const token = crypto.randomUUID();
  const claim = await dbRun(env, `UPDATE jobs SET status='generating',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND status IN ('queued','generating') AND (lease_until IS NULL OR lease_until<=?) AND attempts<?`, token, now + LEASE_MS, now, id, now, MAX_ATTEMPTS);
  if (!claim.meta.changes) {message.ack(); return;}
  const trace = crypto.randomUUID().slice(0, 8), started = Date.now(), timings = {files:{}};
  let renderer, stage = 'render';
  try {
    renderer = rendererFor(env, id);
    const body = JSON.stringify({id, cards:JSON.parse(row.cards_json), seed:row.seed, request_id:row.request_id});
    const response = await renderer.fetch(new Request('http://renderer/render', {method:'POST', headers:{'Content-Type':'application/json', 'Content-Length':String(new TextEncoder().encode(body).length)}, body, signal:AbortSignal.timeout(150000)}));
    if (response.status === 429) {
      await dbRun(env, `UPDATE jobs SET status='queued',attempts=attempts-1,lease_token=NULL,lease_until=NULL,enqueued_at=?,updated_at=? WHERE id=? AND lease_token=?`, Date.now(), Date.now(), id, token);
      message.retry({delaySeconds:5 + Number(id.slice(-2).match(/[0-9]/)?.[0] || 0)}); return;
    }
    if (!response.ok) throw Error(`Renderer status ${response.status}`);
    stage = 'manifest';
    const rendered = await readJSON(response, 262144), manifest = readyManifest(rendered, row);
    timings.render_ms = Date.now() - started;
    const algorithmMs = Date.parse(rendered.ready_at) - Date.parse(rendered.created_at);
    if (Number.isFinite(algorithmMs) && algorithmMs >= 0) timings.algorithm_ms = algorithmMs;
    const uploadStarted = Date.now();
    // Publish the D1 ready state only after every artifact has durable R2 storage.
    const files = Object.entries(FILES);
    for (let offset = 0; offset < files.length; offset += 2) {
      stage = 'artifacts';
      const renewed = await dbRun(env, 'UPDATE jobs SET lease_until=? WHERE id=? AND lease_token=?', Date.now() + LEASE_MS, id, token);
      if (!renewed.meta.changes) {message.ack(); return;}
      const uploaded = await Promise.allSettled(files.slice(offset, offset + 2).map(async ([name, contentType]) => {
        const fileStarted = Date.now();
        try {
          const file = await renderer.fetch(new Request(`http://renderer/files/${id}/${name}`, {signal:AbortSignal.timeout(40000)}));
          if (!file.ok || !file.body) throw Error('Missing renderer artifact');
          const size = Number(file.headers.get('Content-Length'));
          if (!Number.isInteger(size) || size < 1 || size > 25 * 1024 * 1024) throw Error('Invalid artifact size');
          await uploadArtifact(env, id, name, contentType, file, size);
          timings.files[name] = {ms:Date.now() - fileStarted, bytes:size};
        } catch (error) {throw Object.assign(error, {artifact:name});}
      }));
      // Settle both streams before releasing the lease or deleting partial files.
      const failed = uploaded.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    timings.uploads_ms = Date.now() - uploadStarted;
    stage = 'commit';
    const committed = await dbRun(env, `UPDATE jobs SET status='ready',manifest_json=?,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`, JSON.stringify(manifest), Date.now(), id, token);
    if (committed.meta.changes) {
      console.log(JSON.stringify({event:'artwork_ready', trace, attempt:row.attempts + 1, queue_ms:started - row.created_at, total_ms:Date.now() - started, ...timings}));
      await cleanContainer(renderer, id);
    }
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({event:'artwork_attempt_failed', trace, stage:error.artifact ? `artifact:${error.artifact}` : stage, attempt:row.attempts + 1, error:safeError(error)}));
    const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
    const changed = await dbRun(env, `UPDATE jobs SET status=?,error=?,lease_token=NULL,lease_until=NULL,enqueued_at=?,updated_at=? WHERE id=? AND lease_token=?`, exhausted ? 'failed' : 'queued', exhausted ? '作品生成失败，请重新开始。' : null, Date.now(), Date.now(), id, token);
    if (!changed.meta.changes) {message.ack(); return;}
    if (exhausted) {
      try {await env.ARTWORKS.delete(Object.keys(FILES).map(name => objectKey(id, name)));} catch {}
      await cleanContainer(renderer, id); message.ack();
    } else message.retry({delaySeconds:delayFor(row.attempts + 1)});
  }
}

export async function queueHandler(batch, env) {
  // Bound work even if a future Queue configuration delivers a larger batch.
  for (let offset = 0; offset < batch.messages.length; offset += 2) {
    await Promise.all(batch.messages.slice(offset, offset + 2).map(async message => {
      try {await processMessage(message, env);}
      catch (error) {
        console.error(JSON.stringify({event:'artwork_queue_failed', error:safeError(error)}));
        message.retry({delaySeconds:30});
      }
    }));
  }
}

export async function scheduledHandler(_event, env) {
  const now = Date.now();
  const {results} = await env.DB.prepare(`SELECT id FROM jobs WHERE
    (status='queued' AND (enqueued_at IS NULL OR enqueued_at<?)) OR
    (status='generating' AND lease_until<=?) ORDER BY created_at LIMIT 200`).bind(now - 180000, now).all();
  for (let offset = 0; offset < results.length; offset += 100) {
    const ids = results.slice(offset, offset + 100).map(row => row.id);
    await env.GENERATION_QUEUE.sendBatch(ids.map(id => ({body:{id}})));
    await env.DB.batch(ids.map(id => env.DB.prepare('UPDATE jobs SET enqueued_at = ? WHERE id = ?').bind(now, id)));
  }
}

export default {fetch:fetchHandler, queue:queueHandler, scheduled:scheduledHandler};
