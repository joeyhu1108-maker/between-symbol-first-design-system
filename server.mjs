import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([['/','index.html'],...['style.css','app.js','complex-model.js','game-flow.js','game-cards.js'].map(f=>['/'+f,f]),['/vendor/three.module.min.js','vendor/three.module.min.js'],['/vendor/three.core.min.js','vendor/three.core.min.js'],['/media/seedance-concept.mp4','media/seedance-concept.mp4'],['/prototype-3d.html','prototype-3d.html'],['/prototype-3d.css','prototype-3d.css'],['/prototype-3d.js','prototype-3d.js'],['/bridge.js','bridge.js']]);
for(let i=1;i<=12;i++)for(const side of ['seed','illustration']){const file=`assets/print-cards/${String(i).padStart(2,'0')}-${side}.webp`;files.set('/'+file,file)}
for(const file of ['entry-display.js','entry-garden.js','entry-garden.css','phone.html','phone.css','phone.js','nfc-session.js','nfc-tap.html','nfc-test.html','fusion-transition.js','fusion-transition.css','card-handoff.js','card-handoff.css','waiting-shuffle.js','waiting-shuffle.css'])files.set('/'+file,file);
for(const file of ['symbol-interface.js','symbol-interface.css','motion/index.html','motion/style.css','motion/showcase.mjs','motion/player.mjs','motion/src/manifest.mjs','motion/manifest.json','motion/vendor/lottie.min.js','motion/motion_spec.md','motion/between-motion-kit.zip'])files.set('/'+file,file);
files.set('/motion/','motion/index.html');
for(let i=1;i<=12;i++)for(const [folder,extension] of [['animations','json'],['vectors','svg']]){const file=`motion/${folder}/${String(i).padStart(2,'0')}.${extension}`;files.set('/'+file,file)}
const mimeTypes={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',webp:'image/webp',mp4:'video/mp4',zip:'application/zip',md:'text/plain; charset=utf-8'};
// Keep existing exhibition links on 4187 connected to the single printer backend.
function proxyPrinter(req,res){
  const origin=req.headers.origin;
  if(origin&&!['http://127.0.0.1:4187','http://localhost:4187'].includes(origin)){
    res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'origin rejected'}));return;
  }
  const headers={...req.headers,host:'127.0.0.1:8765'};
  if(origin)headers.origin='http://127.0.0.1:8765';
  const upstream=http.request({hostname:'127.0.0.1',port:8765,path:req.url,method:req.method,headers},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  upstream.setTimeout(15000,()=>upstream.destroy(new Error('Printer service timed out')));
  upstream.on('error',()=>{
    if(res.headersSent){res.destroy();return}
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'作品服务未连接，请启动本地服务后重试。'}));
  });
  req.pipe(upstream);
}
http.createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api/')||path==='/printer'||path.startsWith('/printer/')){proxyPrinter(req,res);return}if(path==='/motion'){res.writeHead(302,{Location:'/motion/'});res.end();return}const file=files.get(path);if(!file){res.writeHead(404);res.end('Not found');return;}try{const body=await readFile(new URL(file,import.meta.url));const type=mimeTypes[file.split('.').pop()]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Content-Length':body.byteLength,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(500);res.end('File unavailable');}}).listen(4187,'127.0.0.1',()=>console.log('SEED UNIVERSE ready at http://127.0.0.1:4187'));
