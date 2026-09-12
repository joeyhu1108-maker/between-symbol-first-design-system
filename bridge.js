// Bridge between the symbol console and the local printer backend (printer/server.py).
// On the standalone node server there is no /api, so every helper degrades to the original prototype behaviour.
const json=async(url,init)=>{const r=await fetch(url,{cache:'no-store',...init});const out=await r.json();if(!r.ok)throw Error(out.error||r.statusText);return out};
let health=null;
export function backendReady(){return health??=json('/api/health').then(h=>!!h.ok).catch(()=>false)}

// Latest stable reading from the RDK X5 dice camera, left to right; null when no board is feeding the server.
export async function readDice(){
  if(!await backendReady())return null;
  try{const d=await json('/api/dice');return d.live&&d.values.length?d.values:null}catch{return null}
}

// One card: that card is m and the server draws n from the seed. Two cards: the usual (m, n) pair.
export function createJob(cards,requestId){
  return json('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards,request_id:requestId})});
}
export async function waitForJob(id,onPoll){
  for(;;){
    const job=await json('/api/jobs/'+encodeURIComponent(id));onPoll?.(job);
    if(job.status!=='generating')return job;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}

// Print the artwork: the server sends the JPEG page straight to the printer over IPP and falls back to CUPS.
// Prefers the Mi printer; ?printer=NAME overrides. The server never resubmits a job that is already out.
export async function submitPrint(job){
  const {printers}=await json('/api/printers');
  const wanted=new URLSearchParams(location.search).get('printer');
  const printer=wanted&&printers.includes(wanted)?wanted:printers.find(p=>/^mi[_ ]|xiaomi|小米/i.test(p))??printers[0];
  if(!printer)return {print_status:'no_printer'};
  return json(`/api/jobs/${encodeURIComponent(job.id)}/print`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({printer})});
}

// Direct IPP jobs report printing → printed from the printer itself; CUPS fallback jobs stay at submitted.
export async function waitForPaper(jobId,timeoutMs=45000){
  const end=Date.now()+timeoutMs;let job;
  do{
    job=await json('/api/jobs/'+encodeURIComponent(jobId));
    if(job.print_path!=='ipp-direct'||!['submitted','printing'].includes(job.print_status))return job;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }while(Date.now()<end);
  return job;
}

// The 3D printer scene runs in a same-origin iframe (it uses its own Three.js build) and reports progress by postMessage.
// parent must share the HUD's stacking context so the HUD stays above the scene.
export function mountPrinterScene(job,{parent=document.body,onProgress,onComplete,onError}={}){
  const p=job.params,query=new URLSearchParams({job:job.id,m:p.m,n:p.n,a:p.a,b:p.b,seed:p.seed,embed:1,mode:'live'});
  const frame=document.createElement('iframe');
  frame.className='printer-scene';frame.title='3D 打印机';frame.src='./printer/?'+query;
  parent.append(frame);
  let ready=false,wanted=false,failed=false,timer=0;
  const send=()=>frame.contentWindow?.postMessage({type:'between-printer-start'},location.origin);
  const fail=message=>{if(failed)return;failed=true;clearTimeout(timer);onError?.(message)};
  function onMessage(event){
    if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.type!=='between-printer')return;
    const d=event.data;
    if(d.event==='ready'){ready=true;clearTimeout(timer);if(wanted)send();}
    else if(d.event==='progress')onProgress?.(d.progress,d.phase);
    else if(d.event==='complete')onComplete?.();
    else if(d.event==='error')fail(d.message);
  }
  addEventListener('message',onMessage);
  return {
    start(){frame.classList.add('visible');wanted=true;if(ready)send();else timer=setTimeout(()=>fail('打印机场景载入超时'),30000);},
    close(){clearTimeout(timer);removeEventListener('message',onMessage);frame.remove();}
  };
}
