import {mountGlyph,mountSymbolState,mountSymbolLoading,actionGlyph,stageGlyph,mountMainInterface} from './symbol-interface.js?v=physical-symbol-3';
import * as THREE from './vendor/three.module.min.js';
import {CARDS} from './game-cards.js';
import {backendReady,createJob,waitForJob,mountPrinterScene} from './bridge.js?v=card-fusion-3d-1';
import {mountScanEntry} from './entry-display.js?v=instant-handoff-1';
import {armNfc,triggerNfcFallback,nfcEnabled,stationMode} from './nfc-session.js';
const $=id=>document.getElementById(id);
// PDF pages 1/2, 3/4 ... are one physical card: illustration / seed.
const cardFace=(card,side='seed')=>`./assets/print-cards/${card.id}-${side}.webp`;
const faceImage=(card,side='seed')=>`<img src="${cardFace(card,side)}" fetchpriority="${side==='seed'?'high':'low'}" alt="卡片 ${card.id} ${side==='seed'?'种子面':'插画面'}" draggable="false">`;
const cardFaces=(card,hideSymbol=false)=>`<span class="seed-card-inner"><span class="seed-card-face seed-card-front">${faceImage(card)}${hideSymbol?`<svg class="seed-symbol-cover" viewBox="154 1012 112 72" aria-hidden="true"><image href="${cardFace(card)}" width="800" height="1200"/></svg>`:''}</span><span class="seed-card-face seed-card-back">${faceImage(card,'illustration')}</span></span>`;
// A selected card keeps its printed symbol throughout the interaction.
function setSymbolLoading(id,cards,active){
  if(active)mountSymbolLoading($(id));
  else mountSymbolState($(id),cards.map(card=>card.id),false);
}
const selectedSymbols=()=>[state.growth,state.relation].filter(Boolean).map(value=>CARDS[value-1]);
mountMainInterface();
let entryController=null;
// Keep the frontend rarity rule aligned with printer/rarity.py.
const HIDDEN_PAIR_SETS=[new Set(['01','02']),new Set(['11','12'])];
const isHiddenPair=(a,b)=>HIDDEN_PAIR_SETS.some(pair=>pair.has(a)&&pair.has(b));
const state={stage:'input',growth:null,relation:null,answerId:null,selected:null,job:null,progress:0,rolling:false,shuffleMode:'hand',shuffleStarted:false,shuffling:false,pendingSeedId:null,hiddenPair:false,matched:false,paired:false,requestId:null,key:null,printStarted:false,printerView:null,printerFailed:false,generation:{status:'idle',imageUrl:null,progress:0,job:null}};
let shuffleAnimations=[],cancelDraw=null,pendingArtwork=null,selectionBinding=0;
const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(35,1,.1,100);camera.position.set(0,1.2,9);camera.lookAt(0,.2,0);
let renderer=null;
try{
  renderer=new THREE.WebGLRenderer({canvas:$('scene'),alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
}catch(error){
  // Some exhibition laptops/browser shells do not expose WebGL. Keep the
  // complete game state machine usable so hardware and interaction can still
  // be tested; the canvas remains a quiet visual placeholder in that case.
  document.body.dataset.webgl='unavailable';
}
scene.add(new THREE.HemisphereLight(0xffffff,0xe4d8e0,2));const keyLight=new THREE.PointLight(0xffa39c,5,14);keyLight.position.set(-3,4,4);scene.add(keyLight);const fill=new THREE.PointLight(0x86d7e8,4,15);fill.position.set(4,1,2);scene.add(fill);
const root=new THREE.Group();scene.add(root);const floor=new THREE.Mesh(new THREE.CircleGeometry(5.5,64),new THREE.MeshBasicMaterial({color:0xe8dedf,transparent:true,opacity:.34}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.55;root.add(floor);
function roundedBox(w,h,d,color,op=.85){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,transparent:op<1,opacity:op,roughness:.65,metalness:.05}));return m}
// Input plinth and two dice.
const plinth=roundedBox(3.8,.3,2.2,0xd6c3da,.65);plinth.position.set(-2.25,-1.35,.2);root.add(plinth);
const dice=[];const dieColors=[0xc89acb,0x7dbcc5];
function makeDie(x,color){const g=new THREE.Group();const mesh=roundedBox(.95,.95,.95,color,.95);g.add(mesh);const ring=new THREE.Mesh(new THREE.TorusGeometry(.58,.015,8,40),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.45}));ring.rotation.x=Math.PI/2;g.add(ring);g.position.set(x,-.55,.25);root.add(g);return g}
dice.push(makeDie(-2.85,dieColors[0]),makeDie(-1.65,dieColors[1]));
// The first touch is a visual seed deck now; keep the old die meshes as a
// reserved hardware layer without letting them compete with the cards.
plinth.visible=false; dice.forEach(die=>{die.visible=false});
// Printer body, gantry, bed and printed object (digital twin).
const printer=new THREE.Group();printer.position.set(1.85,-.35,.15);root.add(printer);const body=roundedBox(3.05,2.55,2.25,0xa995bd,.22);body.position.y=-.05;printer.add(body);const bed=roundedBox(2.3,.12,1.55,0xd3c5d7,.8);bed.position.set(0,-.92,.15);printer.add(bed);const gantry=roundedBox(.1,2.1,.1,0x765d80,.8);gantry.position.set(-1.05,.2,.15);printer.add(gantry);const rail=roundedBox(2.2,.09,.09,0x765d80,.8);rail.position.set(0,1.16,.15);printer.add(rail);const nozzle=roundedBox(.18,.3,.18,0xff9a88,.95);nozzle.position.set(-.6,.97,.15);printer.add(nozzle);const printObj=new THREE.Mesh(new THREE.IcosahedronGeometry(.72,2),new THREE.MeshStandardMaterial({color:0xe68ba0,roughness:.35,metalness:.18,transparent:true,opacity:.92}));printObj.position.set(0,-.75,.15);printObj.scale.setScalar(.05);printer.add(printObj);
// 12 card wall in 3D behind printer.
const wall=new THREE.Group();wall.position.set(1.1,1.15,-1.15);root.add(wall);const cardMeshes=[];
function cardTexture(card){const texture=new THREE.TextureLoader().load(cardFace(card,'illustration'));texture.colorSpace=THREE.SRGBColorSpace;return texture}
CARDS.forEach((card,i)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(.4,.6),new THREE.MeshBasicMaterial({transparent:false,opacity:1}));m.position.set((i%6)*.48-1.2,Math.floor(i/6)*.7-.3,0);wall.add(m);cardMeshes.push(m)});
function resize(){const canvas=$('scene')||document.querySelector('canvas')||document.documentElement;const r=canvas.getBoundingClientRect();if(renderer)renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();root.scale.setScalar(Math.min(r.width,r.height)/760)}addEventListener('resize',resize);resize();
function setStage(s){
  if(s!=='selected')cancelDraw?.();
  state.stage=s;document.body.dataset.stage=s;stageGlyph(s);
  $('entryPanel').hidden=s!=='entry';$('selectedPanel').hidden=s!=='selected';$('aiPanel').hidden=s!=='ai';
  document.querySelector('.left-panel').hidden=s!=='input';
  $('printPanel').hidden=!['printing','done'].includes(s);
}
function positionSeedCard(b,index){
    b.style.setProperty('--i',index);
}
function renderSeedDeck(){
  const deck=$('seedDeck'); if(!deck)return; deck.innerHTML='';
  CARDS.forEach((card,index)=>{
    const b=document.createElement('button'); b.className='seed-card'; b.type='button'; b.disabled=!state.shuffleStarted||state.shuffling;b.dataset.cardId=card.id;
    positionSeedCard(b,index);
    b.setAttribute('aria-label',`抽取第 ${card.id} 张种子卡`);b.setAttribute('aria-pressed','false');
    b.innerHTML=cardFaces(card,true);
    b.onclick=()=>selectSeed(index,b); deck.append(b);
  });
}
async function runShuffle(mode=state.shuffleMode){
  const deck=$('seedDeck');if(!deck||!state.shuffleStarted||state.shuffling||state.growth!==null)return;
  state.shuffling=true;
  const previous=[...deck.querySelectorAll('.seed-card')],shuffled=[...previous];
  const before=new Map(previous.map(card=>[card,card.getBoundingClientRect()]));
  const bounds=deck.getBoundingClientRect();
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  if(shuffled.every((card,index)=>card===previous[index])&&shuffled.length>1)[shuffled[0],shuffled[1]]=[shuffled[1],shuffled[0]];
  shuffled.forEach((card,index)=>{card.disabled=true;positionSeedCard(card,index);deck.append(card)});
  $('startShuffle').disabled=true;document.querySelectorAll('.shuffle-mode').forEach(button=>button.disabled=true);
  mountSymbolLoading($('startShuffle'));
  state.shuffleMode=mode;deck.dataset.shuffle=mode;deck.classList.add('is-animating');deck.setAttribute('aria-busy','true');
  const after=new Map(shuffled.map(card=>[card,card.getBoundingClientRect()]));
  const pose=(x,y,scale=1,turn=0,tilt=0)=>`translate3d(${x}px,${y}px,0) scale(${scale}) rotate(${turn}deg) rotateY(${tilt}deg)`;
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const animations=shuffled.map((card,index)=>{
      const from=before.get(card),to=after.get(card),dx=from.x-to.x,dy=from.y-to.y;
      const side=index%2?1:-1,cx=bounds.x+bounds.width/2-to.x-to.width/2,cy=bounds.y+bounds.height/2-to.y-to.height/2;
      const frames=Array.from({length:25},(_,frame)=>{
        const t=frame/24,arc=Math.sin(Math.PI*t),x=dx*(1-t),y=dy*(1-t);
        return {transform:mode==='converge'?pose(x+(cx+side*14-dx*.5)*arc,y+(cy-index*1.5-dy*.5)*arc,1-.28*arc,side*7*arc):mode==='slot'?pose(x,y-side*Math.min(90,to.height*.48)*arc,1-.06*arc,0,side*55*arc):pose(x+side*24*arc,y-28*arc,1-.04*arc,side*8*arc)};
      });
      return card.animate(frames,{duration:mode==='hand'?1080:1260,delay:index*18,easing:'cubic-bezier(.45,0,.2,1)',fill:'both'});
    });
    shuffleAnimations=animations;
    await Promise.allSettled(animations.map(animation=>animation.finished));
    animations.forEach(animation=>animation.cancel());if(shuffleAnimations===animations)shuffleAnimations=[];
  }
    state.shuffling=false;deck.classList.remove('is-animating');deck.setAttribute('aria-busy','false');
    $('shuffleSymbols').hidden=true;$('shuffleSymbols').dataset.active='false';$('shuffleSymbols').setAttribute('aria-busy','false');
    deck.querySelectorAll('.seed-card').forEach(card=>card.disabled=false);
    $('startShuffle').disabled=false;document.querySelectorAll('.shuffle-mode').forEach(button=>button.disabled=false);
    actionGlyph($('startShuffle'),'10');
    $('status').textContent='洗牌完成，翻开一张种子卡。';
    if(state.pendingSeedId){const id=state.pendingSeedId;state.pendingSeedId=null;const index=CARDS.findIndex(card=>card.id===id);const node=deck.querySelector(`[data-card-id="${id}"]`);if(index>=0&&node){selectSeed(index,node);$('status').textContent=`已带入卡片 ${id}，确认后继续。`;}}
}
async function startShuffle(){
  if(state.shuffling||state.growth!==null)return;
  const deck=$('seedDeck');
  if(!state.shuffleStarted){
    state.shuffling=true;$('startShuffle').disabled=true;deck.setAttribute('aria-busy','true');
    $('status').classList.remove('is-error');$('status').textContent='正在准备卡片。';mountSymbolLoading($('startShuffle'));
    try{
      await Promise.all([...deck.querySelectorAll('img')].map(img=>{if(img.complete&&!img.naturalWidth)img.src=img.src;return img.decode()}));
    }catch{
      state.shuffling=false;$('startShuffle').disabled=false;deck.setAttribute('aria-busy','false');actionGlyph($('startShuffle'),'10');
      $('status').textContent='卡片未加载完整，请点击洗牌重试。';$('status').classList.add('is-error');return;
    }
    state.shuffling=false;
  }
  state.shuffleStarted=true;deck.classList.add('is-started');
  actionGlyph($('startShuffle'),'10');$('startShuffle').setAttribute('aria-label','重新洗牌');
  document.querySelectorAll('.shuffle-mode').forEach(button=>button.classList.toggle('is-active',button.dataset.shuffleMode===state.shuffleMode));
  $('status').textContent='正在洗牌。';runShuffle();
}
function selectSeed(index,node){
  if(state.stage!=='input'||!state.shuffleStarted||state.shuffling||!node||state.growth!==null)return;
  const origin=node.getBoundingClientRect();
  node.setAttribute('aria-pressed','true');
  $('startShuffle').disabled=true;document.querySelectorAll('.shuffle-mode').forEach(button=>button.disabled=true);
  showHumanSelection(index+1,false,origin,node);
  $('seedDeck').querySelectorAll('.seed-card').forEach(card=>card.disabled=true);
}
function showHumanSelection(value,remote=false,origin=null,source=null){
  cancelDraw?.();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const neighbours=source&&!reduced?[...$('seedDeck').children].filter(node=>node!==source).map(node=>({html:node.innerHTML,rect:node.getBoundingClientRect()})):[];
  state.growth=value;
  const card=CARDS[value-1];
  const focus=$('humanFocusCard');
  focus.innerHTML=`<span class="human-card-orbit"><span class="human-card-tilt">${cardFaces(card)}</span></span>`;
  focus.dataset.face='seed';focus.setAttribute('aria-pressed','false');
  focus.setAttribute('aria-label',`卡片 ${card.id} 种子面，点击翻转查看插画面`);
  focus.style.setProperty('--tilt-x','0deg');focus.style.setProperty('--tilt-y','0deg');
  mountSymbolState($('humanFocusSymbols'),[card.id],true,{intro:true});
  $('selectedPanel').dataset.remote=String(remote);
  $('lockInput').hidden=false;$('lockInput').disabled=true;
  state.confirmingSelection=false;state.selectionReady=remote;state.focusPending=false;
  $('selectedError').hidden=true;
  $('selectedPanel').setAttribute('aria-label',`在线下找到符号 ${card.id}，手机触碰对应实体卡或点击确认`);
  $('status').textContent='在线下找到这个符号，触碰实体卡或点击确认。';
  setStage('selected');
  if(!remote)prepareSelectedCard().catch(()=>{});
  else syncSelectionButton();
  if(!reduced){
    const target=focus.getBoundingClientRect();
    const panel=$('selectedPanel'),field=document.createElement('div');field.className='card-draw-field';field.setAttribute('aria-hidden','true');
    document.querySelector('.app').append(field);panel.dataset.drawing='true';focus.disabled=true;$('lockInput').disabled=true;
    const cx=target.x+target.width/2,cy=target.y+target.height/2;
    const animations=neighbours.map(({html,rect},index)=>{
      const card=document.createElement('div');card.className='draw-trail-card';card.innerHTML=html;
      Object.assign(card.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});field.append(card);
      const lane=(index/(neighbours.length-1)-.5)*2,angle=lane*1.1;
      const x=cx+Math.sin(angle)*innerWidth*.43-rect.x-rect.width/2,y=cy+Math.abs(lane)*target.height*.15-rect.y-rect.height/2;
      return card.animate([{transform:'translate3d(0,0,0)',opacity:1},{transform:`translate3d(${x}px,${y}px,-100px) rotateY(${-lane*52}deg) scale(.86)`,opacity:.6,offset:.52},{transform:`translate3d(${x*1.1}px,${y+24}px,-250px) rotateY(${-lane*65}deg) scale(.64)`,opacity:0}],{duration:820,easing:'cubic-bezier(.4,0,.2,1)',fill:'both'});
    });
    const dx=origin?origin.x+origin.width/2-cx:0,dy=origin?origin.y+origin.height/2-cy:28,scale=origin?origin.width/target.width:.88;
    const drawFrames=Array.from({length:25},(_,frame)=>{
      const t=frame/24,arc=Math.sin(Math.PI*t);
      return {transform:`translate3d(${dx*(1-t)}px,${dy*(1-t)-20*arc}px,${45*arc}px) scale(${scale+(1-scale)*t}) rotateY(${-Math.sign(dx)*9*arc}deg)`,opacity:origin?1:Math.min(1,t*3)};
    });
    animations.push(focus.animate(drawFrames,{duration:920,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
    let finished=false;
    const finish=()=>{
      if(finished)return;finished=true;animations.forEach(animation=>animation.cancel());field.remove();delete panel.dataset.drawing;
      focus.disabled=false;syncSelectionButton();
      if(cancelDraw===finish)cancelDraw=null;
    };
    cancelDraw=finish;Promise.allSettled(animations.map(animation=>animation.finished)).then(finish);
  }
}
// Keep the float, pointer tilt and reversible flip on separate 3D layers.
$('humanFocusCard').onclick=()=>{
  if(state.stage!=='selected')return;
  const focus=$('humanFocusCard'),flipped=focus.dataset.face!=='illustration';
  focus.dataset.face=flipped?'illustration':'seed';focus.setAttribute('aria-pressed',String(flipped));
  focus.setAttribute('aria-label',`卡片 ${CARDS[state.growth-1].id} ${flipped?'插画面，点击翻回种子面':'种子面，点击翻转查看插画面'}`);
};
$('selectedPanel').addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const focus=$('humanFocusCard'),bounds=$('selectedPanel').getBoundingClientRect();
  focus.style.setProperty('--tilt-x',`${(0.5-(event.clientY-bounds.y)/bounds.height)*10}deg`);
  focus.style.setProperty('--tilt-y',`${((event.clientX-bounds.x)/bounds.width-0.5)*18}deg`);
});
$('selectedPanel').addEventListener('pointerleave',()=>{
  $('humanFocusCard').style.setProperty('--tilt-x','0deg');$('humanFocusCard').style.setProperty('--tilt-y','0deg');
});
function syncSelectionButton(){
  $('lockInput').disabled=state.stage!=='selected'||state.focusPending||state.confirmingSelection||$('selectedPanel').dataset.drawing==='true';
}
async function prepareSelectedCard(){
  const binding=++selectionBinding,card=state.growth;
  state.focusPending=true;syncSelectionButton();
  try{
    await entryController?.focusCard?.(card);
    if(binding===selectionBinding&&state.stage==='selected'&&state.growth===card)state.selectionReady=true;
  }catch(error){
    if(binding===selectionBinding&&state.stage==='selected'&&state.growth===card){$('selectedError').textContent=error.message;$('selectedError').hidden=false;}
    throw error;
  }finally{
    if(binding===selectionBinding){state.focusPending=false;syncSelectionButton();}
  }
}
async function confirmSelectedCard(){
  if(state.stage!=='selected'||state.focusPending||state.confirmingSelection)return;
  state.confirmingSelection=true;syncSelectionButton();$('selectedError').hidden=true;
  try{
    if(!state.selectionReady)await prepareSelectedCard();
    // Both station inputs commit the same server session; its poll starts the draw.
    if(await entryController?.confirmCard?.())return;
    confirmHumanCard(state.growth);
  }catch(error){
    $('selectedError').textContent=error.message;$('selectedError').hidden=false;
  }finally{
    state.confirmingSelection=false;syncSelectionButton();
  }
}
function confirmHumanCard(cardId,aiValue,requestId){
  if(state.stage!=='selected'||state.rolling||Number(cardId)!==state.growth)return;
  if(requestId)state.requestId=requestId;
  return handOverToAI(aiValue);
}
function artworkRequestId(){
  state.requestId??=typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  entryController?.rememberRequestId(state.requestId);
  return state.requestId;
}
async function handOverToAI(aiValue){
  if(state.stage!=='selected'||state.growth===null||state.rolling)return;
  state.rolling=true;setStage('ai');$('humanDraw').innerHTML=faceImage(CARDS[state.growth-1]);
  const remaining=CARDS.filter(card=>Number(card.id)!==state.growth);
  for(let i=remaining.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
  const picked=remaining.find(card=>Number(card.id)===aiValue)||remaining[Math.floor(Math.random()*remaining.length)];
  const human=state.growth,requestId=artworkRequestId(),cards=[human,Number(picked.id)];
  // Start computing during the draw, but reveal neither the card nor the job early.
  pendingArtwork={requestId,cards:cards.join(','),result:createJob(cards,requestId).then(job=>({job}),error=>({error}))};
  const currentDraw=()=>state.stage==='ai'&&state.growth===human&&state.requestId===requestId;
  const deck=$('aiDeck');deck.classList.remove('is-picked');deck.innerHTML=remaining.map((card,index)=>`<span class="ai-candidate" style="--draw-i:${index};--draw-x:${(index-5)*13}px;--draw-r:${(index-5)*3}deg">${faceImage(card)}</span>`).join('');
  setSymbolLoading('aiSymbols',[CARDS[state.growth-1]],true);deck.setAttribute('aria-busy','true');
  await new Promise(resolve=>setTimeout(resolve,2200));
  if(!currentDraw()){state.rolling=false;return;}
  state.relation=Number(picked.id);state.hiddenPair=isHiddenPair(CARDS[state.growth-1].id,picked.id);
  if(state.hiddenPair)document.body.dataset.hiddenPair='true';
  deck.innerHTML=faceImage(picked);deck.classList.add('is-picked');deck.setAttribute('aria-busy','false');
  setSymbolLoading('aiSymbols',selectedSymbols(),false);
  await new Promise(resolve=>setTimeout(resolve,1000));
  if(!currentDraw()){state.rolling=false;return;}
  state.rolling=false;startFusion();
}
async function preGenerateArtwork(key){
  const generation=state.generation;
  if(generation.status==='generating'||generation.status==='ready')return;
  if(generation.job?.status==='failed')state.requestId=null;
  const requestId=artworkRequestId(),cards=[state.growth,state.relation];
  const isCurrent=()=>state.generation===generation&&state.requestId===requestId&&cards[0]===state.growth&&cards[1]===state.relation;
  generation.status='generating';generation.progress=0;generation.imageUrl=null;
  if(state.stage==='printing')updatePrintReady();
  try{
    let created;
    if(pendingArtwork?.requestId===requestId&&pendingArtwork.cards===cards.join(',')){
      const pending=pendingArtwork;pendingArtwork=null;
      const result=await pending.result;if(!isCurrent())return;if(result.error)throw result.error;created=result.job;
    }else{
      const available=await backendReady();if(!isCurrent())return;
      if(!available)throw Error('作品服务暂时未连接，你抽中的卡片已保留，请稍后重试。');
      created=await createJob(cards,requestId);
    }
    if(!isCurrent())return;
    generation.job=created;state.job=created.id;$('jobText').textContent=created.id;
    // Preparing the paper-print session does not confirm or enqueue a print.
    armNfc(created,CARDS[state.growth-1].id,()=>{
      if(isCurrent())syncPhone('print-confirmed',{job:created.id});
    });
    syncPhone('job-created',{job:state.job,key,answerId:CARDS[state.growth-1].id});
    const started=performance.now();
    const done=await waitForJob(created.id,job=>{
      if(!isCurrent())return;
      generation.job=job;
      generation.progress=job.status==='queued'?0:Math.min(.95,(performance.now()-started)/6000);
      if(state.stage==='printing')$('printTitle').setAttribute('aria-label',job.status==='queued'?'作品正在排队':'作品正在生成');
    });
    if(!isCurrent())return;
    generation.job=done;
    if(done.status!=='ready')throw Error(done.error||'作品生成失败，请重试。');
    generation.imageUrl=done.image;generation.progress=1;generation.status='ready';
    const params=new URLSearchParams({job:done.id});
    $('downloadArtwork').href=done.pdf;
    $('openPrinter').href=`./printer/?${params}`;
    syncPhone('artwork-ready',{job:done.id,image:done.image,pdf:done.pdf});
    preparePrinterScene();
    if(state.stage==='printing')updatePrintReady();
  }catch(error){
    if(!isCurrent())return;
    generation.status='failed';generation.error=error.message;
    if(state.stage==='printing')updatePrintReady();
  }
}
function syncPhone(type,payload={}){const message={type:`between:${type}`,...payload};window.parent!==window&&window.parent.postMessage(message,location.origin);window.opener?.postMessage(message,location.origin);window.dispatchEvent(new CustomEvent('between-sync',{detail:message}))}
function startFusion(){
  if(state.stage!=='ai'||state.growth===null||state.relation===null||state.paired)return;
  state.answerId=state.growth-1;state.selected=state.answerId;state.matched=true;state.paired=true;
  state.key=`${CARDS[state.growth-1].id} · ${CARDS[state.relation-1].id}`;
  syncPhone('pairing',{cardId:CARDS[state.growth-1].id});
  state.printerFailed=false;
  preGenerateArtwork(state.key);
  showPrintReady();
}
function showPrintProgress(p,phase){
  if(phase)document.body.dataset.printerPhase=phase;
  state.progress=Math.max(0,Math.min(1,p));
  $('printProgress').style.width=`${Math.round(state.progress*100)}%`;
  $('percentText').textContent=`${Math.round(state.progress*100)}%`;
  mountGlyph($('layerText'),state.progress<1?'12':'08');$('layerText').setAttribute('aria-label',state.progress<1?'3D 打印预演':'预演完成');
}
function updatePaperPrint(){
  const generation=state.generation,button=$('paperPrint');
  button.hidden=!nfcEnabled||generation.status!=='ready';
  button.disabled=['sending','confirmed'].includes(generation.paperPrint);
  button.setAttribute('aria-busy',String(generation.paperPrint==='sending'));
  button.setAttribute('aria-label',generation.paperPrint==='sending'?'正在确认打印':generation.paperPrint==='confirmed'?'打印已确认，请到设备取作品':'打印这件作品');
}
async function printPaper(){
  const generation=state.generation,job=generation.job,card=CARDS[state.growth-1];
  if(!nfcEnabled||!state.paired||generation.status!=='ready'||!job||!card||!['printing','done'].includes(state.stage)||$('restart').disabled||generation.paperPrintStopped||['sending','confirmed'].includes(generation.paperPrint))return;
  const current=()=>state.generation===generation&&generation.job===job&&state.growth===Number(card.id)&&!$('restart').disabled&&!generation.paperPrintStopped;
  clearTimeout(generation.paperRetryTimer);generation.paperRetryUntil??=Date.now()+120000;
  generation.paperPrint='sending';$('paperPrintError').hidden=true;updatePaperPrint();
  try{
    const run=await triggerNfcFallback(job,card.id);
    if(!current())return;
    if(!run)throw Error('打印连接尚未准备好，请稍后重试。');
    generation.paperPrint='confirmed';
    syncPhone('print-confirmed',{job:job.id});
  }catch(error){
    if(!current())return;
    generation.paperPrint='idle';$('paperPrintError').textContent=error.message;$('paperPrintError').hidden=false;
    $('artworkActions').hidden=false;
    // The NFC adapter retains the original run/event identity, including when a reply was lost.
    if(Date.now()<generation.paperRetryUntil)generation.paperRetryTimer=setTimeout(()=>{
      if(current()&&generation.paperPrint==='idle')printPaper();
    },2000);
  }finally{if(current())updatePaperPrint();}
}
function finishPrint(){
  if(!state.printStarted||state.stage!=='printing')return;
  setStage('done');showPrintProgress(1);
  mountGlyph($('printTitle'),'08');$('printTitle').setAttribute('aria-busy','false');$('printTitle').setAttribute('aria-label','作品已保存，3D 预演完成');
  $('printCopy').textContent=nfcEnabled?'3D 预演完成。实体打印状态见 NFC 联调记录，请到设备确认出纸。':'作品与 PDF 已保存。3D 预演完成，尚未送往纸张打印机。';
  $('artworkActions').hidden=false;$('restart').hidden=false;updatePaperPrint();
  syncPhone('preview-complete',{job:state.job,image:state.generation.job.image,pdf:state.generation.job.pdf});
}
function preparePrinterScene(){
  const job=state.generation.job;
  if(state.generation.status!=='ready'||!job||state.printerView)return;
  state.printerView=mountPrinterScene(job,{
    parent:$('scene').parentElement,
    onStart:()=>{document.body.dataset.printerPhase='fusion';},
    onProgress:showPrintProgress,onComplete:finishPrint,
    onError:()=>{
      state.printerFailed=true;state.printStarted=false;
      document.body.dataset.previewRunning='false';
      delete document.body.dataset.printerPhase;
      state.printerView?.close();state.printerView=null;
      if(state.stage==='printing')updatePrintReady();
    }
  });
}
function updatePrintReady(){
  const generation=state.generation;
  const ready=generation.status==='ready';$('printCopy').classList.toggle('is-error',generation.status==='failed'||state.printerFailed);
  if(generation.status==='generating')setSymbolLoading('printTitle',selectedSymbols(),true);
  else {mountGlyph($('printTitle'),generation.status==='failed'?'11':'12');$('printTitle').setAttribute('aria-busy','false');}
  $('printTitle').setAttribute('aria-label',ready?'作品已就绪，开始 3D 预演':'等待作品生成');
  $('printArt').src=generation.imageUrl||'';$('printArt').hidden=!ready;
  $('printArt').alt=`作品 ${state.job||''}`;
  $('artworkActions').hidden=!ready;updatePaperPrint();
  $('startPrintButton').hidden=false;
  $('startPrintButton').disabled=generation.status==='generating';
  const action=generation.status==='failed'?'重新生成作品':state.printerFailed?'重试 3D 预演':'开始 3D 打印预演';
  $('startPrintButton').setAttribute('aria-label',action);
  actionGlyph($('startPrintButton'),generation.status==='failed'||state.printerFailed?'06':'12');
  $('printCopy').textContent=generation.status==='failed'?generation.error:!ready?'作品还在生成，完成后即可继续。':state.printerFailed?'3D 场景加载失败，可以重试；作品和 PDF 已保存。':'作品已保存。开始预演，观看它在打印机中成形。';
  if(ready&&!state.printerFailed)preparePrinterScene();
  if(ready&&state.paired&&!state.printStarted&&!state.printerFailed)startPrint();
}
function showPrintReady(){
  setStage('printing');root.visible=false;
  document.body.dataset.printerPhase='loading';
  $('restart').hidden=true;showPrintProgress(0);mountGlyph($('layerText'),'12');$('layerText').setAttribute('aria-label','等待启动');
  updatePrintReady();
}
function startPrint(){
  if(state.stage!=='printing'||state.printStarted)return;
  if(state.generation.status==='failed'){preGenerateArtwork(state.key);return;}
  if(state.generation.status!=='ready')return;
  state.printerFailed=false;preparePrinterScene();
  if(!state.printerView)return;
  state.printStarted=true;document.body.dataset.previewRunning='true';$('printCopy').classList.remove('is-error');
  if(state.paired)printPaper();
  document.body.dataset.printerPhase='loading';
  setSymbolLoading('printTitle',selectedSymbols(),true);$('printTitle').setAttribute('aria-label','正在播放 3D 打印预演');
  $('printCopy').textContent='同一件作品正在 3D 打印机中成形。';
  $('startPrintButton').hidden=true;$('artworkActions').hidden=true;$('restart').hidden=true;
  showPrintProgress(0);state.printerView.start();
}
async function restartExperience(){
  if($('restart').disabled)return;
  $('restart').disabled=true;$('restart').setAttribute('aria-label','正在开始下一轮');
  state.generation.paperPrintStopped=true;clearTimeout(state.generation.paperRetryTimer);
  mountSymbolLoading($('restart'));state.printerView?.close();
  await entryController?.reset();
  location.href=stationMode?'./prototype-3d.html?mode=station'+(nfcEnabled?'&nfc=1':''):'./';
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.opener&&event.source!==window.parent)return;
  const data=event.data||{};
  if(data.type==='between:phone-card')confirmHumanCard(data.cardId);
});
$('lockInput').onclick=confirmSelectedCard;$('startPrintButton').onclick=startPrint;$('paperPrint').onclick=printPaper;$('restart').onclick=restartExperience;$('startShuffle').onclick=startShuffle;document.querySelectorAll('.shuffle-mode').forEach(button=>button.onclick=()=>{if(state.shuffling||state.growth!==null)return;state.shuffleMode=button.dataset.shuffleMode;document.querySelectorAll('.shuffle-mode').forEach(item=>{item.classList.toggle('is-active',item===button);item.setAttribute('aria-pressed',String(item===button))})});renderSeedDeck();setStage('input');
const incomingCard=new URLSearchParams(location.search).get('card');
if(incomingCard){
  const index=CARDS.findIndex(card=>card.id===incomingCard.padStart(2,'0'));
  if(index>=0){state.pendingSeedId=CARDS[index].id;startShuffle();}
  else {$('status').textContent='卡片编号无法识别，请重新选择一张种子卡。';$('status').classList.add('is-error');}
}
else if(!new URLSearchParams(location.search).has('local')){
  setStage('entry');entryController=mountScanEntry((card,aiCard,requestId)=>confirmHumanCard(card,aiCard,requestId),()=>setStage('input'),card=>{if(card)showHumanSelection(card,true);else{state.growth=null;setStage('entry')}},{online:!stationMode});
}
if(!stationMode)$('openPrinter').hidden=true;
// Labels remain available to assistive technology without visible instructions.
document.querySelectorAll('[title]').forEach(node=>node.removeAttribute('title'));
window.addEventListener('pagehide',()=>{state.generation.paperPrintStopped=true;clearTimeout(state.generation.paperRetryTimer);state.printerView?.close();shuffleAnimations.forEach(animation=>animation.cancel());cancelDraw?.();});
window.addEventListener('resize',()=>{shuffleAnimations.forEach(animation=>animation.cancel());cancelDraw?.();});
function loop(now){if(renderer&&!document.hidden&&['printing','done'].includes(state.stage)){printer.rotation.y=Math.sin(now*.0004)*.02;wall.rotation.y=Math.sin(now*.00025)*.025;printObj.rotation.y+=.006;renderer.render(scene,camera)}requestAnimationFrame(loop)}requestAnimationFrame(loop);
