import {mountGlyph,mountSymbolState,mountSymbolLoading,actionGlyph} from './symbol-interface.js?v=loading-sequence-2';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),nfcEntry=params.has('card'),tagCard=Number(params.get('card'));
let sessionId=params.get('session'),storageKey=sessionId?`seed-phone:${sessionId}`:null;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const journeyGlyphs={connect:'01',draw:'10',screen:'07'};
const face=(id,side='seed')=>`./assets/print-cards/${String(id).padStart(2,'0')}-${side}.webp`;
const symbolCover=id=>`<svg class="seed-symbol-cover" viewBox="154 1012 112 72" aria-hidden="true"><image href="${face(id)}" width="800" height="1200"/></svg>`;
const validCard=id=>Number.isInteger(id)&&id>=1&&id<=12;
let saved={};
try{if(storageKey)saved=JSON.parse(sessionStorage.getItem(storageKey)||'{}')||{};}catch{}
const bytes=new Uint8Array(16);
crypto.getRandomValues(bytes);
let participantId=typeof saved.participantId==='string'?saved.participantId:Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
try{if(sessionId)participantId=localStorage.getItem(`between-phone-participant:${sessionId}`)||participantId;}catch{}
const savedOrder=Array.isArray(saved.order)&&saved.order.length===12&&new Set(saved.order).size===12&&saved.order.every(validCard)?saved.order:null;
const state={session:null,joined:false,connecting:false,order:savedOrder||Array.from({length:12},(_,index)=>index+1),selected:nfcEntry&&validCard(tagCard)?tagCard:validCard(saved.selected)?saved.selected:null,started:!!saved.started,shuffling:false,revealing:false,selecting:false,selectionFailed:false,previewSynced:false,revision:0,submitting:false,submitAttempted:!!saved.submitAttempted,uncertain:false,polling:false,view:'connecting',retry:null,pollTimer:null,stopped:false,departing:false,departed:!!saved.departed};

function persist(){
  if(!storageKey)return;
  try{sessionStorage.setItem(storageKey,JSON.stringify({participantId,order:state.order,selected:state.selected,started:state.started,departed:state.departed,submitAttempted:state.submitAttempted}));}catch{}
  // NFC can open a new tab. Keep this round's phone identity on the same browser.
  try{if(state.joined)localStorage.setItem(`between-phone-participant:${sessionId}`,participantId);}catch{}
}
function announce(message){$('status').textContent=message;}
function showError(message,retry=null,retryLabel='重新连接现场大屏'){$('error').textContent=message;$('error').hidden=false;state.retry=retry;state.retryLabel=retryLabel;renderAction();}
function clearError(){$('error').hidden=true;$('error').textContent='';state.retry=null;}
function setLoading(id,active){mountSymbolLoading($(id),active);}
function setView(view){
  state.view=view;$('phone').dataset.view=view;
  const revealing=['ready','sending','departing','submitted','accepted'].includes(view);
  $('field').hidden=revealing||view==='connecting';$('reveal').hidden=!revealing;$('connecting').hidden=view!=='connecting';
  $('handoff').hidden=!['submitted','accepted'].includes(view);
  $('handoffHint').textContent=view==='sending'?'正在确认连接，卡片还在你手中。':view==='departing'?'交给现场的另一端。':view==='submitted'?'卡片已送出，请抬头看电脑。':view==='accepted'?'电脑已接住，AI 正在抽另一张。':nfcEntry?'这张卡属于你，另一张交给 AI。':'一张属于你的卡，另一张交给 AI。';
  $('drawHint').hidden=view!=='draw'||!state.started||state.shuffling;
  const step=view==='connecting'?'connect':['submitted','accepted'].includes(view)?'screen':'draw';
  document.querySelectorAll('.journey-step').forEach(element=>{
    element.classList.toggle('is-current',element.dataset.step===step);
    element.classList.toggle('is-complete',element.dataset.step==='connect'&&step!=='connect');
    mountGlyph(element,journeyGlyphs[element.dataset.step],{ambient:element.dataset.step===step});
  });
  renderAction();
}
function renderAction(){
  const button=$('action'),busy=state.connecting||state.submitting||state.selecting||state.revealing;
  const loading=!state.stopped&&$('error').hidden;
  setLoading('connecting',loading&&state.connecting&&state.view==='connecting');
  if(state.view==='accepted')mountSymbolState($('handoffSymbol'),['08'],false);
  else setLoading('handoffSymbol',loading&&state.view==='submitted');
  const glyph=id=>{if(loading&&!button.hidden&&state.view!=='connecting'&&(state.connecting||state.submitting||state.selecting))setLoading('action',true);else actionGlyph(button,id);};
  $('redraw').hidden=nfcEntry||state.view!=='ready'||busy||!!state.retry;
  if(state.retry){button.hidden=false;glyph('10');button.disabled=busy;button.ariaLabel=state.retryLabel;button.title=button.ariaLabel;return;}
  button.hidden=['departing','submitted','accepted','error'].includes(state.view);
  button.classList.toggle('is-handoff',['ready','sending'].includes(state.view));
  if(['ready','sending'].includes(state.view)){glyph('07');button.ariaLabel=state.connecting?'正在连接现场电脑':state.selecting?'正在同步卡片到现场大屏':state.submitting?'正在确认与电脑的连接':'送到电脑，让 AI 抽卡';button.disabled=busy||!state.joined||(!nfcEntry&&!state.previewSynced);}
  else{glyph(state.started?'10':'01');button.ariaLabel=state.selecting?'正在同步卡片到现场大屏':state.started?'重新洗牌':'开始洗牌，然后抽取一张卡';button.disabled=!state.joined||state.shuffling||busy||state.view==='connecting';}
  button.title=button.ariaLabel;
}
function renderDeck(){
  $('deck').innerHTML=state.order.map(id=>`<button class="seed-card${state.selected===id?' is-chosen':''}" type="button" data-card-id="${id}" aria-label="抽取第 ${id} 张种子卡" aria-pressed="${state.selected===id}" disabled><span class="seed-card-inner"><span class="seed-card-face"><img src="${face(id)}" alt="" draggable="false">${symbolCover(id)}</span><span class="seed-card-face seed-card-back"><img src="${face(id,'illustration')}" alt="" draggable="false"></span></span></button>`).join('');
  $('deck').dataset.started=String(state.started);
  $('deck').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>pickCard(Number(button.dataset.cardId))));
  updateDeck();
}
function updateDeck(){
  $('deck').querySelectorAll('button').forEach(button=>{button.disabled=!state.joined||!state.started||state.shuffling||state.revealing||state.selecting||!!state.selected||state.view!=='draw';});
}
function showChosen(){
  if($('chosenCard').dataset.cardId!==String(state.selected)){
    $('chosenCard').dataset.cardId=String(state.selected);
    $('chosenCard').innerHTML=`<div class="card-float"><button class="chosen-flip" type="button" aria-label="你抽中的第 ${state.selected} 张种子卡，点击翻到背面" aria-pressed="false"><span class="chosen-card-inner"><span class="chosen-face"><img src="${face(state.selected)}" alt="" draggable="false"></span><span class="chosen-face chosen-back"><img src="${face(state.selected,'illustration')}" alt="" draggable="false"></span></span></button></div>`;
    $('chosenCard').querySelector('button').addEventListener('click',event=>{
      const button=event.currentTarget,flipped=button.getAttribute('aria-pressed')!=='true';
      button.setAttribute('aria-pressed',String(flipped));
      button.ariaLabel=`你抽中的第 ${state.selected} 张种子卡，点击翻到${flipped?'正':'背'}面`;
    });
    mountGlyph($('revealSymbols'),String(state.selected).padStart(2,'0'),{ambient:true,intro:true});
  }
}
async function departCard(){
  if(state.departed||state.departing)return;
  state.departing=true;setView('departing');
  const card=$('chosenCard');card.getAnimations().forEach(animation=>animation.cancel());
  try{
    if(!reducedMotion)await card.animate([
      {transform:'translate3d(0,0,0) scale(1) rotateX(0deg)',opacity:1,offset:0},
      {transform:'translate3d(0,18px,18px) scale(1.025) rotateX(-8deg)',opacity:1,offset:.2},
      {transform:`translate3d(0,${-innerHeight*.85}px,-220px) scale(.48) rotateX(28deg)`,opacity:0,offset:1}
    ],{duration:680,easing:'cubic-bezier(.55,0,.8,.25)',fill:'forwards'}).finished;
  }catch{}finally{state.departing=false;state.departed=true;persist();}
}
let handoffRequest=null;
async function confirmHandoff(){
  if(handoffRequest||!state.departed||state.stopped)return;
  handoffRequest=request('/handoff',{participant_id:participantId});
  try{applySession(await handoffRequest);}
  catch(error){
    if(error.status===404||error.status===410)stopSession('expired');
    else showError('卡片已送出，正在恢复与电脑的连接。',confirmHandoff);
  }finally{handoffRequest=null;schedulePoll();}
}
async function request(suffix='',body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${suffix}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||'连接失败');error.status=response.status;error.code=data.code;throw error;}
    return data.session||data;
  }finally{clearTimeout(timeout);}
}
function mayHaveSubmitted(){return state.submitAttempted||state.submitting||state.uncertain||state.departed||state.departing||['submitted','accepted'].includes(state.session?.status);}
function reconnectCurrent(){
  if(!nfcEntry||!validCard(tagCard)||mayHaveSubmitted())return;
  // Only an explicit retry may leave an unsubmitted round. Reload also discards its pending responses.
  const next=new URL(location.href);next.searchParams.delete('session');location.replace(next.href);
}
function stopSession(status){
  const submitted=mayHaveSubmitted(),keepCard=nfcEntry&&validCard(tagCard)&&!state.departed;
  state.stopped=true;state.revision++;clearTimeout(state.pollTimer);state.joined=false;state.shuffling=false;
  $('shuffleLoading').hidden=true;setLoading('shuffleLoading',false);$('deck').classList.remove('is-shuffling');$('deck').setAttribute('aria-busy','false');
  if(keepCard){state.selected=tagCard;setView('ready');showChosen();}else setView('error');
  updateDeck();
  const reason=status==='busy'?'前一位正在体验，请等待电脑准备下一轮。':status==='mismatch'?'本轮连接对应另一张卡，请让电脑准备下一轮。':status==='expired'?'这次连接已过期。':'这次连接已经结束。';
  const retry=nfcEntry&&validCard(tagCard)&&!submitted?reconnectCurrent:null;
  const recovery=submitted?'这轮已尝试送卡，请先让工作人员核对；不会自动重发。体验新一轮时，请等电脑准备好后重新碰 NFC。':retry?'卡片还在你手中；电脑准备好后，点下方按钮重新连接，再由你确认送出。':'请等待电脑准备下一轮，再重新碰你选择的 NFC 卡。';
  if(keepCard)$('handoffHint').textContent=submitted?'请先核对本轮交卡结果。':'卡片还在你手中，等待下一轮。';
  showError(reason+recovery,retry,'重新连接当前入口');
  announce($('error').textContent);
}
function applySession(session){
  if(state.departing)return;
  if(['closed','expired'].includes(session.status)){stopSession(session.status);return;}
  if(nfcEntry&&((session.selected_card&&session.selected_card!==tagCard)||(session.cards?.length&&session.cards[0]!==tagCard))){stopSession('mismatch');return;}
  if(['submitted','accepted'].includes(state.session?.status)&&['waiting','joined','selected'].includes(session.status))return;
  if(state.session?.status==='accepted'&&session.status==='submitted')return;
  state.session=session;
  if(['submitted','accepted'].includes(session.status)){
    state.submitAttempted=true;persist();
    if(!Array.isArray(session.cards)||session.cards.length!==1||!validCard(session.cards[0])){showError('大屏返回的卡片信息不完整，请重新连接。',refresh);return;}
    if(!state.departed){state.selected=session.cards[0];showChosen();departCard().then(()=>applySession(session));return;}
    const unchanged=state.view===session.status&&state.selected===session.cards[0];
    state.selected=session.cards[0];state.selectionFailed=false;state.previewSynced=true;state.uncertain=false;state.revealing=false;persist();
    clearError();
    if(!unchanged){setView(session.status);showChosen();updateDeck();}else renderAction();
    announce(session.status==='accepted'?'现场大屏已接收你的卡片，请抬头看 AI 抽取另一张。':'卡片已提交，正在把另一次抽卡交给现场大屏上的 AI。');
    if(session.handoff_ready===false)confirmHandoff();
    if(session.status==='accepted'){state.stopped=true;clearTimeout(state.pollTimer);}
  }else if(!state.submitting&&!state.revealing&&!state.selecting){
    const previousCard=state.selected;
    state.selected=validCard(session.selected_card)?session.selected_card:nfcEntry?tagCard:null;
    state.previewSynced=!!state.selected;
    if(state.selected)state.started=true;else $('chosenCard').dataset.cardId='';
    persist();
    const nextView=state.selected?'ready':'draw',changed=state.view!==nextView||previousCard!==state.selected;
    state.uncertain=false;clearError();setView(nextView);if(state.selected&&changed)showChosen();updateDeck();
  }
}
function schedulePoll(){
  clearTimeout(state.pollTimer);
  if(!state.stopped&&state.joined&&!state.selectionFailed)state.pollTimer=setTimeout(refresh,1200);
}
async function refresh(){
  if(state.stopped||state.polling||state.selecting||state.selectionFailed||state.departing)return;
  state.polling=true;
  const revision=state.revision;
  try{const session=await request();if(revision===state.revision)applySession(session);}
  catch(error){
    if(revision!==state.revision)return;
    if(error.status===404||error.status===410){stopSession('expired');return;}
    showError(state.view==='submitted'?'连接暂时中断，正在确认现场大屏是否已接收。':'连接暂时中断，请重试。',refresh);
  }finally{state.polling=false;schedulePoll();}
}
async function connect(){
  state.stopped=false;state.connecting=true;clearError();
  if(nfcEntry&&validCard(tagCard)){state.selected=tagCard;setView('ready');showChosen();$('handoffHint').textContent='正在连接现场电脑…';}else setView('connecting');
  try{
    if(nfcEntry&&!validCard(tagCard)){state.stopped=true;setView('error');showError('标签卡号无效，请联系现场工作人员。');return;}
    if(nfcEntry&&!sessionId){
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);let current;
      try{
        const response=await fetch('/api/entry/current',{cache:'no-store',signal:controller.signal});
        current=await response.json();
        if(!response.ok)throw Error(current.error||'现场电脑尚未准备好，请稍后重试。');
      }finally{clearTimeout(timeout);}
      sessionId=current.id;storageKey=`seed-phone:${sessionId}`;
      try{const previous=JSON.parse(sessionStorage.getItem(storageKey)||'{}');if(typeof previous.participantId==='string')participantId=previous.participantId;state.departed=!!previous.departed;state.submitAttempted=!!previous.submitAttempted;}catch{}
      try{participantId=localStorage.getItem(`between-phone-participant:${sessionId}`)||participantId;}catch{}
      const bound=new URL(location.href);bound.searchParams.set('session',sessionId);history.replaceState(null,'',bound);
      persist();
    }
    if(!sessionId||sessionId.length>128){stopSession('expired');return;}
    const current=await request();
    if(['closed','expired'].includes(current.status)){stopSession(current.status);return;}
    const joined=await request('/join',{participant_id:participantId});
    state.joined=true;persist();applySession(joined);schedulePoll();
    if(state.view==='draw')announce(state.started?'请抽取一张种子卡。':'先点击开始洗牌，再抽取一张种子卡。');
  }catch(error){
    if(error.status===409){stopSession('busy');}
    else if(error.status===404||error.status===410){stopSession('expired');}
    else{if(nfcEntry&&validCard(tagCard)){setView('ready');showChosen();}else setView('error');showError(error.message||'暂时无法连接现场电脑，请检查网络后重试。',connect);}
  }finally{state.connecting=false;renderAction();}
}
function shuffle(){
  if(!state.joined||state.shuffling||state.revealing||state.selecting||state.submitting||state.stopped||state.selected||!['draw','ready'].includes(state.view))return;
  state.selected=null;state.started=true;state.shuffling=true;clearError();setView('draw');
  const deck=$('deck');
  const oldPositions=new Map([...deck.children].map(button=>[Number(button.dataset.cardId),button.getBoundingClientRect()]));
  const previous=[...state.order];
  for(let index=state.order.length-1;index>0;index--){const other=Math.floor(Math.random()*(index+1));[state.order[index],state.order[other]]=[state.order[other],state.order[index]];}
  if(state.order.every((id,index)=>id===previous[index]))state.order.push(state.order.shift());
  renderDeck();persist();deck.classList.add('is-shuffling');deck.setAttribute('aria-busy','true');
  $('shuffleLoading').hidden=false;setLoading('shuffleLoading',true);
  const duration=reducedMotion?180:1450;
  if(!reducedMotion)[...deck.children].forEach((button,index)=>{
    const before=oldPositions.get(Number(button.dataset.cardId)),after=button.getBoundingClientRect();
    button.animate([{transform:`translate(${before.left-after.left}px,${before.top-after.top}px) rotate(${index%2?7:-7}deg)`},{transform:'translate(0,0) rotate(0deg)'}],{duration:1150+index*20,easing:'cubic-bezier(.2,.7,.2,1)'});
  });
  announce('正在洗牌。');
  setTimeout(()=>{
    state.shuffling=false;deck.classList.remove('is-shuffling');deck.setAttribute('aria-busy','false');$('shuffleLoading').hidden=true;setLoading('shuffleLoading',false);
    if(state.stopped)return;
    setView('draw');updateDeck();announce('洗牌完成，请抽取一张种子卡。');
  },duration);
}
function pickCard(id){
  if(!validCard(id)||!state.joined||!state.started||state.shuffling||state.revealing||state.selecting||state.selected||state.stopped||state.view!=='draw')return;
  state.selected=id;state.revealing=true;persist();
  const button=$('deck').querySelector(`[data-card-id="${id}"]`);button.classList.add('is-chosen');button.setAttribute('aria-pressed','true');updateDeck();renderAction();
  announce(`你抽中了第 ${id} 张卡，正在同步到现场大屏。`);
  syncSelection(id);
  setTimeout(()=>{state.revealing=false;if(state.stopped||['submitted','accepted'].includes(state.view))return;setView('ready');showChosen();},reducedMotion?0:660);
}
async function syncSelection(card,afterSync){
  if(state.selecting||state.submitting||state.stopped||!state.joined)return;
  state.selecting=true;state.selectionFailed=false;state.previewSynced=false;state.revision++;clearError();renderAction();
  let session;
  try{session=await request('/select',{participant_id:participantId,card});}
  catch(error){
    if(error.status===409){
      try{
        const current=await request();
        if(['submitted','accepted'].includes(current.status)){state.selecting=false;applySession(current);schedulePoll();return;}
      }catch{}
    }
    if(error.status===404||error.status===410)stopSession('expired');
    else{state.selectionFailed=true;showError('卡片还未同步到大屏，请点击重试。',()=>syncSelection(card,afterSync));}
  }finally{state.selecting=false;}
  if(session){
    state.selected=card;state.previewSynced=card!==null;persist();applySession(session);
    if(!state.stopped)afterSync?.();
  }
  renderAction();schedulePoll();
}
async function submit(){
  if(state.submitting||state.selecting||(!nfcEntry&&!state.previewSynced)||state.uncertain||!validCard(state.selected)||state.view!=='ready'||!state.joined||state.stopped)return;
  state.submitting=true;state.submitAttempted=true;state.revision++;clearError();setView('sending');showChosen();persist();
  announce('正在发送卡片，请稍候。');
  try{const confirmed=await request('/cards',{participant_id:participantId,cards:[state.selected],handoff_required:true});await departCard();applySession(confirmed);}
  catch(error){
    if(error.status===404||error.status===410){stopSession('expired');}
    else if(error.status===403){stopSession('busy');}
    else{
      state.uncertain=true;
      showError('正在确认卡片提交状态，请稍候。',refresh);
    }
  }finally{state.submitting=false;renderAction();schedulePoll();}
}
$('action').addEventListener('click',()=>{if(state.retry){state.retry();return;}if(state.view==='ready')submit();else shuffle();});
$('redraw').addEventListener('click',()=>{if(state.view==='ready'&&!state.revealing)syncSelection(null,shuffle);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.joined&&!state.stopped)refresh();});
actionGlyph($('redraw'),'10');mountGlyph($('drawHint'),'01');
if(!nfcEntry)renderDeck();persist();connect();
