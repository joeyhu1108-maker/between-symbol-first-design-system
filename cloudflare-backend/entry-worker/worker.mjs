export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(url.protocol==='http:'){
      url.protocol='https:';
      return Response.redirect(url.href,308);
    }
    const artifact=/^\/printer\/jobs\/SG-\d{8}-\d+-[A-F0-9]{8}\/(artwork\.(png|webp|pdf)|particles\.json)$/.test(url.pathname);
    const proxied = url.pathname.startsWith('/api/') || url.pathname.startsWith('/printer/jobs/') || url.pathname === '/nfc-print-agent.py';
    if (!proxied) {
      if (['/','/scene','/tap','/printer/'].includes(url.pathname)) {
        url.pathname = url.pathname==='/printer/'?'/printer/index.html':url.pathname==='/tap'?'/nfc-tap.html':'/prototype-3d.html';
        return env.ASSETS.fetch(new Request(url, request));
      }
      return env.ASSETS.fetch(request);
    }
    const headers = new Headers(request.headers);
    if (headers.has('Origin') && headers.get('Origin') !== url.origin) {
      return Response.json({error: 'origin rejected'}, {status: 403});
    }
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method not allowed', {status: 405});
    const read = ['GET', 'HEAD'].includes(request.method);
    const job = /^\/api\/jobs\/SG-\d{8}-\d+-[A-F0-9]{8}$/.test(url.pathname);
    const cloudRoute = (read && (url.pathname === '/api/health' || job || artifact)) || (request.method === 'POST' && url.pathname === '/api/jobs');
    if (env.ARTWORK_BACKEND && cloudRoute) {
      try {
        // Preserve the public URL and Origin for the backend's same-origin check.
        const response = await env.ARTWORK_BACKEND.fetch(request);
        if (read && (job || artifact) && response.status === 404) {
          await response.body?.cancel();
        } else {
          const type = (response.headers.get('Content-Type') || '').toLowerCase();
          if ((url.pathname.startsWith('/api/') && /text\/html|application\/xhtml\+xml/.test(type)) || (response.status >= 500 && !type.includes('application/json'))) {
            await response.body?.cancel();
            return Response.json({error:'作品服务暂时不可用，请稍后重试。'}, {status:503,headers:{'Cache-Control':'no-store','Retry-After':response.headers.get('Retry-After')||'5'}});
          }
          return response;
        }
      } catch {
        return Response.json({error:'作品服务暂时不可用，请稍后重试。'}, {status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
      }
    }
    const cacheKey=new Request(url.origin+url.pathname);
    if(artifact&&request.method==='GET'){
      const cached=await caches.default.match(cacheKey);
      if(cached)return cached;
    }
    function finish(response){
      if(artifact&&request.method==='GET'&&response.status===200)ctx.waitUntil(caches.default.put(cacheKey,response.clone()));
      return response;
    }
    const upstream = new URL(env.UPSTREAM);
    const target = new URL(url.pathname + url.search, upstream);
    headers.delete('Host');
    headers.set('Origin', upstream.origin);
    headers.set('X-Between-Public-Origin', url.origin);
    try {
      const response = await fetch(target, {
        method: request.method, headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual', signal: AbortSignal.timeout(25000)
      });
      const output = new Headers(response.headers);
      const type=(output.get('Content-Type')||'').toLowerCase();
      if((url.pathname.startsWith('/api/')&&/text\/html|application\/xhtml\+xml/.test(type))||(response.status>=500&&!type.includes('application/json'))){
        await response.body?.cancel();
        return Response.json({error:'作品服务暂时不可用，请稍后重试。'}, {status:503,headers:{'Cache-Control':'no-store','Retry-After':output.get('Retry-After')||'5'}});
      }
      output.set('Cache-Control', artifact&&response.status===200?'public, max-age=31536000, immutable':'no-store');
      const location = output.get('Location');
      if (location?.startsWith(upstream.origin)) output.set('Location', location.replace(upstream.origin, url.origin));
      if (request.method !== 'HEAD' && (output.get('Content-Type') || '').includes('application/json')) {
        const text = (await response.text()).replaceAll(upstream.origin, url.origin);
        output.delete('Content-Length');
        output.delete('Content-Encoding');
        return finish(new Response(text, {status: response.status, headers: output}));
      }
      return finish(new Response(response.body, {status: response.status, headers: output}));
    } catch {
      return Response.json({error: '现场电脑暂时离线，请稍后重试。'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }
};
