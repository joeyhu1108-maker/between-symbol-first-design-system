const control=sessionStorage.getItem('between-nfc-control');
export const stationMode=location.pathname==='/scene'||new URLSearchParams(location.search).get('mode')==='station';
export const nfcEnabled=stationMode&&new URLSearchParams(location.search).has('nfc')&&!!control;
let timer=null,version=0,active=null,paused=false,epoch=0;
const names={armed:'等待电脑确认打印',waiting_artwork:'打印已确认，作品正在生成',waiting_printer:'打印已确认，等待打印接收端',claimed:'打印接收端已领取作品',submitted:'已提交系统打印队列，请现场确认出纸',failed:'打印提交失败',uncertain:'提交结果不确定，请检查打印队列',cancelled:'本轮已取消，请回主控准备下一轮'};
let panel=null;
if(nfcEnabled){
  panel=document.createElement('aside');panel.id='nfcHardwareStatus';panel.setAttribute('aria-live','polite');
  panel.style.cssText='position:fixed;left:16px;bottom:36px;z-index:1000;max-width:min(400px,90vw);padding:10px 14px;background:#f5f2e8f2;border:1px solid #b6c0ae;border-radius:8px;color:#344b35;font:13px/1.5 sans-serif;overflow-wrap:anywhere;pointer-events:none';
  panel.hidden=true;document.body.append(panel);
}
async function api(path,data){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(path,{method:data?'POST':'GET',headers:{'X-Test-Control':control,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:controller.signal});
    const value=await response.json();if(!response.ok)throw Error(value.error||'连接失败');return value;
  }finally{clearTimeout(timeout);}
}
function acceptRun(session,run){
  if(active!==session||version!==session.version)throw Error('本轮已变化，请重新核对作品');
  if(!run||run.job_id!==session.jobId||run.card_id!==session.cardId||(session.runId&&run.id!==session.runId))throw Error('NFC 等待已被另一轮替换，请回联调主控检查');
  session.runId=run.id;
}
function isCurrent(session,stamp){return !paused&&active===session&&version===session.version&&epoch===stamp;}
function showRun(run){panel.hidden=run.state==='armed'&&!run.error;panel.textContent=`NFC ${run.card_id} · ${names[run.state]||run.state}${run.error?' · '+run.error:''}`;}
export function armNfc(job,cardId,onTap){
  if(!nfcEnabled)return;
  clearTimeout(timer);const current=++version;
  const phoneSessionId=document.getElementById('entryPanel')?.dataset.sessionId;
  const session=active={version:current,jobId:job.id,cardId:String(cardId).padStart(2,'0'),runId:null,received:false,armRequest:null,fallback:null,eventId:crypto.randomUUID(),verified:true,statusOnly:false,poll:null};
  async function poll(){
    const stamp=epoch;
    if(!isCurrent(session,stamp))return;
    try{
      if(session.statusOnly&&!session.runId){
        if(!session.armRequest)throw Error('原测试轮次尚未确认，请回联调主控核对');
        const original=await session.armRequest;
        if(!isCurrent(session,stamp))return;
        acceptRun(session,original.run);
      }
      const result=session.runId?await api('/api/nfc/status'):await(session.armRequest??=api('/api/nfc/arm',{jobId:job.id,cardId,...(phoneSessionId?{sessionId:phoneSessionId}:{})}));
      if(!isCurrent(session,stamp))return;
      const run=result.run;
      acceptRun(session,run);session.verified=true;showRun(run);
      if(run.received_at&&!session.received&&!['failed','uncertain','cancelled'].includes(run.state)){session.received=true;onTap(run);}
      if(['submitted','failed','uncertain','cancelled'].includes(run.state))return;
    }catch(error){if(!isCurrent(session,stamp))return;if(!session.statusOnly)session.armRequest=null;session.verified=false;panel.hidden=false;panel.textContent='NFC 连接待恢复 · '+error.message;}
    if(isCurrent(session,stamp))timer=setTimeout(poll,2000);
  }
  session.poll=poll;
  poll();
}
export async function triggerNfcFallback(job,cardId){
  if(!nfcEnabled)return null;
  const session=active;
  if(!session||session.jobId!==job?.id||session.cardId!==String(cardId).padStart(2,'0'))throw Error('本轮作品尚未准备好，请核对后重试');
  if(paused||!session.verified)throw Error('NFC 联调正在恢复，请稍后核对本轮状态');
  if(session.fallback)return session.fallback;
  const stamp=epoch;
  const pending=session.fallback=(async()=>{
    if(!session.runId){
      if(!session.armRequest)throw Error('NFC 联调尚未连接，请稍后重试');
      const original=await session.armRequest;
      if(!isCurrent(session,stamp))throw Error('本轮已变化或页面已暂停，请重新核对作品');
      acceptRun(session,original.run);
    }
    if(!isCurrent(session,stamp))throw Error('本轮已变化或页面已暂停，请重新核对作品');
    const {run}=await api('/api/nfc/fallback',{runId:session.runId,jobId:session.jobId,cardId:session.cardId,eventId:session.eventId});
    if(!isCurrent(session,stamp))throw Error('确认已发送，但画面轮次已变化或页面已暂停，请到主控核对打印状态');
    if(!run||run.id!==session.runId||run.card_id!==session.cardId||!run.received_at)throw Error('未收到本轮确认，请到主控核对打印状态');
    showRun(run);
    if(['failed','uncertain','cancelled'].includes(run.state))throw Error(run.error||names[run.state]);
    session.received=true;
    return run;
  })();
  try{return await pending;}finally{if(session.fallback===pending)session.fallback=null;}
}
addEventListener('pagehide',()=>{
  paused=true;epoch++;clearTimeout(timer);
  if(active){active.verified=false;active.statusOnly=true;active.fallback=null;}
});
addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  paused=false;epoch++;clearTimeout(timer);
  if(active){active.verified=false;active.statusOnly=true;active.poll();}
});
