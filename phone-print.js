import {mountGlyph,mountSymbolLoading} from './symbol-interface.js?v=loading-sequence-2';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const sessionId=params.get('session'),card=params.get('card');
const validCard=/^(0?[1-9]|1[0-2])$/.test(card||''),cardId=validCard?card.padStart(2,'0'):null;
const terminal=['submitted','failed','uncertain','cancelled'];
const labels={armed:'确认配对并打印',waiting_artwork:'已确认，花园正在生成',waiting_printer:'已确认，正在等待打印机',claimed:'打印接收程序已领取作品',submitted:'已提交打印队列，请到打印机处确认出纸',failed:'打印提交失败，请联系现场工作人员',uncertain:'打印结果待核实，请联系现场工作人员，不要重复打印',cancelled:'本轮已取消，请等待下一轮'};
let participantId,run=null,eventId=null,busy=false,timer=null,paused=false,requestVersion=0;
try{participantId=localStorage.getItem(`between-phone-participant:${sessionId}`)||JSON.parse(sessionStorage.getItem(`seed-phone:${sessionId}`)||'{}').participantId;}catch{}
function error(message){$('error').textContent=message;$('error').hidden=false;$('status').textContent=message;}
function action(label,disabled,handler){const button=$('action');button.hidden=false;button.disabled=disabled;button.ariaLabel=label;button.title=label;button.textContent=label;button.onclick=handler;}
async function api(path,data){
  const response=await fetch('/api/nfc/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,participantId,...data}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const failure=Error(result.error||'暂时无法连接，请稍后重试');failure.status=response.status;throw failure;}
  return result.run;
}
function accept(next){
  if(!next||!next.id||!next.card_id)throw Error('本轮作品尚未准备好，请稍后重试');
  if(run&&run.id!==next.id)throw Object.assign(Error('电脑已经切换作品，请让工作人员核对本轮'),{status:409});
  run=next;
  $('target').hidden=false;mountGlyph($('targetSymbol'),run.card_id,{ambient:true});
  if(!eventId){
    const key=`between-phone-print:${run.id}`;
    try{eventId=sessionStorage.getItem(key);}catch{}
    eventId||=crypto.randomUUID();
    try{sessionStorage.setItem(key,eventId);}catch{}
  }
  render();
}
function render(){
  $('error').hidden=true;$('notice').hidden=true;$('status').textContent=labels[run.state]||'正在连接打印机';
  const received=!!run.received_at;
  if(received){
    $('phone').dataset.view='submitted';$('handoff').hidden=false;$('action').hidden=true;
    mountSymbolLoading($('handoffSymbol'),!terminal.includes(run.state));
    if(terminal.includes(run.state)){
      mountGlyph($('handoffSymbol'),run.card_id,{ambient:true});
      // Queue submission is not physical paper confirmation.
      if(run.state==='submitted'){$('notice').textContent=labels.submitted;$('notice').hidden=false;}
      else error(labels[run.state]||'请到现场核对打印结果');
    }
  }else if(terminal.includes(run.state)){
    action('本轮已结束',true,null);error(labels[run.state]);
  }else if(run.card_id!==cardId){
    action('请碰与大屏目标符号一致的卡',true,null);
    error('这张卡的符号与本轮目标不同，请对照大屏，再碰对应的卡。');
  }else action(labels.armed,busy,confirm);
}
function schedule(){clearTimeout(timer);if(!paused&&run&&!terminal.includes(run.state))timer=setTimeout(refresh,2000);}
async function refresh(){
  if(busy||paused)return;
  busy=true;const version=++requestVersion;
  try{const next=await api('phone-status');if(version===requestVersion&&!paused)accept(next);}
  catch(failure){
    if(version!==requestVersion||paused)return;
    error(failure.message);
    if([401,403,404,410].includes(failure.status)){
      action('请让现场工作人员核对连接',true,null);clearTimeout(timer);return;
    }
    action('重新核对本轮作品',false,refresh);return;
  }finally{busy=false;if(run&&version===requestVersion&&!paused&&$('error').hidden)render();}
  schedule();
}
async function confirm(){
  if(busy||paused||!run||run.card_id!==cardId||run.received_at||run.state!=='armed')return;
  busy=true;clearTimeout(timer);const version=++requestVersion;
  action('正在确认打印',true,null);$('action').setAttribute('aria-busy','true');
  try{
    const next=await api('phone-confirm',{runId:run.id,cardId,eventId});
    if(next?.received_at&&version===requestVersion&&!paused&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      try{await $('chosenCard').animate([{transform:'translateY(0) scale(1)',opacity:1},{transform:`translateY(${-innerHeight*.7}px) scale(.45)`,opacity:0}],{duration:650,easing:'cubic-bezier(.55,0,.8,.25)',fill:'forwards'}).finished;}catch{}
    }
    if(version===requestVersion&&!paused)accept(next);
  }catch(failure){
    if(version!==requestVersion||paused)return;
    error(failure.status?failure.message:'确认结果正在核对，请点击重新连接，不要重复操作');
    action('重新核对打印结果',false,refresh);
  }finally{busy=false;$('action').setAttribute('aria-busy','false');}
  schedule();
}
if(validCard){
  const image=document.createElement('img');image.src=`./assets/print-cards/${cardId}-seed.webp`;image.alt='本次碰到的卡片';
  const floating=document.createElement('div');floating.className='card-float';floating.append(image);$('chosenCard').append(floating);
}
if(!validCard||!sessionId){action('请重新碰卡',true,null);error('标签或本轮连接无效，请重新碰卡');}
else if(!participantId){action('请使用原手机浏览器',true,null);error('请使用刚才抽卡的同一个手机浏览器打开；也可以请工作人员在电脑确认打印');}
else refresh();
addEventListener('pagehide',()=>{paused=true;requestVersion++;clearTimeout(timer);});
addEventListener('pageshow',event=>{if(event.persisted){paused=false;busy=false;if(participantId&&validCard)refresh();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&participantId&&validCard&&!paused)refresh();});
