// Same-origin artwork API shared by the local and Cloudflare backends.
const json=async(url,init,timeout=10000)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{cache:'no-store',...init,signal:controller.signal});let out;
    try{out=await r.json()}catch(error){if(r.ok)throw error}
    if(!r.ok)throw Object.assign(Error(out?.error||r.statusText),{status:r.status,retryAfter:out?.retry_after,retryAfterHeader:r.headers.get('Retry-After')});
    return out;
  }
  catch(error){if(controller.signal.aborted)throw Object.assign(Error('作品服务响应超时，请重试'),{retryable:true});throw error}
  finally{clearTimeout(timer)}
};
let health=null;
export function backendReady(){
  return health??=json('/api/health',undefined,15000).then(h=>{if(!h.ok)health=null;return !!h.ok}).catch(()=>{health=null;return false});
}

// Latest stable reading from the RDK X5 dice camera, left to right; null when no board is feeding the server.
export async function readDice(){
  if(!await backendReady())return null;
  try{const d=await json('/api/dice');return d.live&&d.values.length?d.values:null}catch{return null}
}

// One card: that card is m and the server draws n from the seed. Two cards: the usual (m, n) pair.
function retryDelay(value){
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
  const seconds=Number(value);
  if(Number.isFinite(seconds))return seconds>=0?seconds*1000:null;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-Date.now()):null;
}
const canRetry=error=>error.retryable||error instanceof TypeError||[408,429,500,502,503,504].includes(error.status);
export async function createJob(cards,requestId){
  const deadline=Date.now()+120000;
  const init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards,request_id:requestId})};
  let attempt=0,lastError;
  while(Date.now()<deadline){
    try{return await json('/api/jobs',init,Math.min(10000,deadline-Date.now()))}
    catch(error){
      if(!canRetry(error))throw error;
      lastError=error;
      const hint=retryDelay(error.retryAfter)??retryDelay(error.retryAfterHeader)??0;
      const delay=Math.max(hint,Math.min(2000*2**attempt++,10000))*(1+Math.random()*.2);
      if(Date.now()+delay>=deadline)break;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
  if(lastError?.status!==429)throw lastError||Error('作品服务暂时未连接，请用同一组卡片重试。');
  throw Object.assign(Error('当前参与人数较多，作品队列仍满，请稍后重试。'),{status:429});
}
export async function waitForJob(id,onPoll){
  const deadline=Date.now()+1800000;let attempt=0;
  while(Date.now()<deadline){
    let job;
    try{job=await json('/api/jobs/'+encodeURIComponent(id),undefined,Math.min(10000,deadline-Date.now()));attempt=0;}
    catch(error){
      if(!canRetry(error))throw error;
      const hint=retryDelay(error.retryAfter)??retryDelay(error.retryAfterHeader)??0;
      const delay=Math.max(hint,Math.min(2000*2**attempt++,15000))*(1+Math.random()*.2);
      await new Promise(resolve=>setTimeout(resolve,Math.min(delay,Math.max(0,deadline-Date.now()))));
      continue;
    }
    onPoll?.(job);
    if(!['queued','generating'].includes(job.status))return job;
    await new Promise(resolve=>setTimeout(resolve,(job.status==='queued'?2000:1000)*(1+Math.random()*.2)));
  }
  throw Error('作品仍未完成，请点击重试继续查看原来的作品。');
}

// The 3D printer scene runs in a same-origin iframe (it uses its own Three.js build) and reports progress by postMessage.
// parent must share the HUD's stacking context so the HUD stays above the scene.
export function mountPrinterScene(job,{parent=document.body,onStart,onProgress,onComplete,onError}={}){
  const p=job.params,query=new URLSearchParams({job:job.id,m:p.m,n:p.n,a:p.a,b:p.b,seed:p.seed,embed:1,mode:'live',intro:'cards'});
  const frame=document.createElement('iframe');
  frame.className='printer-scene';frame.title='3D 打印机';
  let ready=false,wanted=false,started=false,finished=false,failed=false,closed=false,timer=0;
  const send=()=>{if(started||failed||closed)return;started=true;frame.classList.add('visible');onStart?.();frame.contentWindow?.postMessage({type:'between-printer-start'},location.origin)};
  const detach=()=>{clearTimeout(timer);removeEventListener('message',onMessage);frame.removeEventListener('error',onFrameError)};
  const fail=message=>{if(failed||closed||finished)return;failed=true;detach();onError?.(message)};
  const onFrameError=()=>fail('打印机场景载入失败');
  function onMessage(event){
    if(failed||closed||finished||event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.type!=='between-printer')return;
    const d=event.data;
    if(d.event==='ready'){ready=true;clearTimeout(timer);if(wanted)send();}
    else if(d.event==='progress'&&started)onProgress?.(d.progress,d.phase);
    else if(d.event==='complete'&&started){finished=true;detach();onComplete?.();}
    else if(d.event==='error')fail(d.message);
  }
  addEventListener('message',onMessage);
  frame.addEventListener('error',onFrameError);
  timer=setTimeout(()=>fail('打印机场景载入超时'),45000);
  frame.src='./printer/?'+query;
  parent.append(frame);
  return {
    start(){if(wanted||failed||closed||finished)return;wanted=true;if(ready)send();},
    close(){if(closed)return;closed=true;detach();frame.remove();}
  };
}
