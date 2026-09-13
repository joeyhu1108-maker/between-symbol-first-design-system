import {receivePhoneCard,cancelCardHandoff} from './card-handoff.js';
import {mountWaitingShuffle} from './waiting-shuffle.js?v=front-first-1';
const STORAGE='between-screen-session';
const $=id=>document.getElementById(id);
async function request(path,data){
  const headers=data?{'Content-Type':'application/json'}:{};
  if(path.endsWith('/publish'))headers['X-Test-Control']=sessionStorage.getItem('between-nfc-control')||'';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,signal:controller.signal});
    const value=await response.json();if(!response.ok){const error=Error(value.error||'连接暂时中断，请重试。');error.status=response.status;throw error;}return value;
  }finally{clearTimeout(timeout);}
}
export function mountScanEntry(onCard,onLocal,onSelect,{online=false}={}){
  let session=null,timer=null,stopped=false,applied=false,starting=false,previewCard=null,epoch=0,startup=null,localDrawing=false,available=false;
  const connected=!!sessionStorage.getItem('between-nfc-control');
  $('entryPanel').dataset.waitingShuffle='true';$('entryPanel').setAttribute('aria-label','等待手机送来你的卡片');
  $('entryCode').hidden=true;$('entryWaiting').hidden=true;$('entryQr').removeAttribute('src');
  $('retryEntry').setAttribute('aria-label','重新连接现场');$('retryEntry').title='重新连接现场';
  const waiting=mountWaitingShuffle($('entryPanel').querySelector('.entry-center'));
  if(online&&!connected){
    $('entryPanel').setAttribute('aria-label','开始你与 AI 的抽卡');
    $('localEntry').setAttribute('aria-label','开始抽卡');$('localEntry').title='开始抽卡';
    $('localEntry').onclick=()=>{waiting.destroy();onLocal();};
    window.addEventListener('pagehide',()=>waiting.destroy(),{once:true});
    return {reset(){waiting.destroy();},rememberRequestId(){},async focusCard(){return false;},async confirmCard(){return false;}};
  }
  function save(){sessionStorage.setItem(STORAGE,JSON.stringify(session))}
  function error(message){$('entryError').textContent=message;$('entryError').hidden=false;$('retryEntry').hidden=false}
  function show(snapshot){
    const joined=snapshot.status!=='waiting';
    $('entryPanel').dataset.connected=String(joined);
    $('entryCode').hidden=true;$('entryWaiting').hidden=true;
    $('entryWaiting').dataset.active=String(joined);
    $('entryWaiting').setAttribute('aria-label',snapshot.status==='submitted'?'已抽卡，正在同步到大屏':'手机已连接，等待抽卡');
  }
  function clearPreview(){if(previewCard!==null){previewCard=null;onSelect?.(null);}}
  function expire(){
    epoch++;clearTimeout(timer);waiting.stop();session=null;sessionStorage.removeItem(STORAGE);clearPreview();delete $('entryPanel').dataset.sessionId;
    $('entryCode').hidden=true;$('entryWaiting').hidden=true;
    error('本次连接已结束，请重新连接现场。');
  }
  async function poll(version=epoch){
    if(stopped||!session||version!==epoch)return;
    const id=session.id,current=()=>!stopped&&version===epoch&&session?.id===id;
    try{
      const snapshot=await request(`/api/sessions/${id}`);
      if(!current())return;
      if(['closed','expired'].includes(snapshot.status)){if(!applied)expire();return;}
      const committed=['submitted','accepted'].includes(snapshot.status);
      if(!applied||committed){
        show(snapshot);$('entryError').hidden=true;$('retryEntry').hidden=true;
        const selected=snapshot.status==='selected'?snapshot.selected_card:null;
        if(!committed&&selected!==previewCard){previewCard=selected;onSelect?.(selected);}
        if(committed&&snapshot.handoff_ready!==false){
          if(!applied){
            applied=true;
            waiting.stop();
            if(previewCard!==snapshot.cards[0]){previewCard=snapshot.cards[0];onSelect?.(previewCard);}
            if(!localDrawing)await receivePhoneCard(snapshot.cards[0]);
            if(!current())return;
            onCard(snapshot.cards[0],snapshot.ai_card,session.request_id||snapshot.request_id);
          }
          if(snapshot.status!=='accepted')await request(`/api/sessions/${id}/ack`,{owner_token:session.owner_token});
          return;
        }
      }
    }catch(e){if(current()){if((e.status===404||e.status===410)&&!applied){expire();return;}error(e.message);}}
    if(current())timer=setTimeout(()=>poll(version),900);
  }
  function start(){
    if(!startup)startup=startSession().finally(()=>{startup=null;});
    return startup;
  }
  async function startSession(){
    if(starting||stopped)return;starting=true;const version=++epoch,current=()=>!stopped&&version===epoch;
    available=false;clearTimeout(timer);if(!localDrawing)waiting.start();$('retryEntry').hidden=true;$('entryError').hidden=true;
    try{
      if(!session)try{session=JSON.parse(sessionStorage.getItem(STORAGE))}catch{session=null;}
      if(session){
        try{const snapshot=await request(`/api/sessions/${session.id}`);if(!current())return;if(['closed','expired'].includes(snapshot.status)||!session.phone_url){session=null;clearPreview();}}
        catch(e){if(!current())return;if(e.status===404||e.status===410){session=null;clearPreview();}else throw e;}
      }
      if(!session){const created=await request('/api/sessions',{});if(!current())return;session=created;applied=false;save();}
      if(!current())return;
      await request(`/api/sessions/${session.id}/publish`,{owner_token:session.owner_token});
      if(!current())return;
      available=true;
      $('entryPanel').dataset.sessionId=session.id;
      if(!session.phone_url){error('现场连接尚未准备好，请重新连接。');return;}
      $('entryPhoneLink').href=session.phone_url;
      $('entryCode').hidden=true;await poll(version);
    }catch(e){if(current())error(e.message);}
    finally{starting=false;}
  }
  async function focusCard(card){
    if(!connected)return false;
    await start();
    if(!session||stopped||!available)throw Error('现场连接尚未准备好，请重新连接。');
    const snapshot=await request(`/api/sessions/${session.id}/focus`,{owner_token:session.owner_token,card});
    previewCard=snapshot.selected_card;
    return true;
  }
  async function confirmCard(){
    if(!connected)return false;
    if(!session||stopped)throw Error('现场连接尚未准备好，请重新连接。');
    await request(`/api/sessions/${session.id}/confirm`,{owner_token:session.owner_token});
    // The existing poll is the single delivery path for phone and screen confirmation.
    return true;
  }
  async function reset(){
    stopped=true;epoch++;clearTimeout(timer);waiting.destroy();cancelCardHandoff();sessionStorage.removeItem(STORAGE);delete $('entryPanel').dataset.sessionId;
    if(session)try{await request(`/api/sessions/${session.id}/close`,{owner_token:session.owner_token})}catch{}
  }
  $('retryEntry').onclick=start;
  $('localEntry').onclick=()=>{localDrawing=true;waiting.stop();onLocal()};
  window.addEventListener('pagehide',()=>{stopped=true;epoch++;clearTimeout(timer);waiting.destroy();cancelCardHandoff()},{once:true});
  if(sessionStorage.getItem('between-nfc-control'))start();
  else {error('现场设备尚未连接，可以直接点击开始抽卡。');$('retryEntry').hidden=true;}
  return {reset,focusCard,confirmCard,rememberRequestId(id){if(session){session.request_id=id;save();}}};
}
