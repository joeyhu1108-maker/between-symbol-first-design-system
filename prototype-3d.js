import * as THREE from './vendor/three.module.min.js';
import {CARDS} from './game-cards.js';
import {backendReady,createJob,waitForJob,mountPrinterScene,submitPrint,waitForPaper} from './bridge.js';
const $=id=>document.getElementById(id);
const stageNames={input:'◒',key:'✦',cards:'◇',printing:'▧',done:'✓'};
// Keep the frontend rarity rule aligned with printer/rarity.py.
const HIDDEN_PAIR_SETS=[new Set(['01','02']),new Set(['11','12'])];
const HIDDEN_CARD_IDS=new Set(HIDDEN_PAIR_SETS.flatMap(pair=>[...pair]));
const isHiddenPair=(a,b)=>HIDDEN_PAIR_SETS.some(pair=>pair.has(a)&&pair.has(b));
const state={stage:'input',growth:null,relation:null,answerId:null,selected:null,job:null,progress:0,rolling:false,shuffleMode:'hand',shuffleStarted:false,shuffleTimer:null,hiddenPair:false,paired:false,printerView:null,printerFailed:false,generation:{status:'idle',imageUrl:null,progress:0,job:null}};
const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(35,1,.1,100);camera.position.set(0,1.2,9);camera.lookAt(0,.2,0);
let renderer=null;
try{
  renderer=new THREE.WebGLRenderer({canvas:$('#scene'),alpha:true,antialias:true});
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
function cardTexture(card){const c=document.createElement('canvas');c.width=220;c.height=300;const x=c.getContext('2d');const bg=x.createLinearGradient(0,0,220,300);bg.addColorStop(0,'#fffefa');bg.addColorStop(.48,'#f3edf9');bg.addColorStop(1,'#eae1f5');x.fillStyle=bg;x.fillRect(0,0,c.width,c.height);const glow=x.createRadialGradient(110,142,8,110,142,105);glow.addColorStop(0,`${card.color}70`);glow.addColorStop(.35,`${card.color}28`);glow.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=glow;x.fillRect(12,12,196,276);x.strokeStyle='#b9aaf0';x.lineWidth=2;x.strokeRect(10,10,c.width-20,c.height-20);x.strokeStyle='rgba(116,91,145,.38)';x.lineWidth=1;x.strokeRect(17,17,c.width-34,c.height-34);x.fillStyle='#725b8e';x.font='12px monospace';x.textAlign='left';x.fillText(card.id,24,34);x.textAlign='right';x.fillStyle='rgba(114,91,142,.7)';x.font='10px monospace';x.fillText('⌘',196,34);x.textAlign='center';x.fillStyle='#73598e';x.shadowColor=card.color;x.shadowBlur=18;x.font='56px Georgia';x.fillText(card.symbol,110,146);x.shadowBlur=0;x.fillStyle='#73598e';x.font='bold 18px monospace';x.fillText(card.symbol,110,266);return new THREE.CanvasTexture(c)}
CARDS.forEach((card,i)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(.42,.58),new THREE.MeshBasicMaterial({map:cardTexture(card),transparent:true,opacity:.72}));m.position.set((i%6)*.48-1.2,Math.floor(i/6)*.7-.3,0);wall.add(m);cardMeshes.push(m)});
function resize(){const canvas=$('scene')||document.querySelector('canvas')||document.documentElement;const r=canvas.getBoundingClientRect();if(renderer)renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();root.scale.setScalar(Math.min(r.width,r.height)/760)}addEventListener('resize',resize);resize();
function setStage(s){state.stage=s;document.body.dataset.stage=s;$('stageLabel').textContent=stageNames[s]||s;document.querySelector('.left-panel').hidden=s!=='input';['keyPanel','cardsPanel','printPanel'].forEach(id=>$(id).hidden=true);if(s==='key')$('keyPanel').hidden=false;if(s==='cards')$('cardsPanel').hidden=false;if(s==='printing'||s==='done')$('printPanel').hidden=false}
const seedSymbols=CARDS.map(card=>card.symbol);
function renderSeedDeck(){
  const deck=$('seedDeck'); if(!deck)return; deck.innerHTML='';
  seedSymbols.forEach((symbol,index)=>{
    const b=document.createElement('button'); b.className='seed-card'; b.type='button'; b.disabled=!state.shuffleStarted;
    const spread=(index%6)-2.5;
    b.style.setProperty('--i',index);
    b.style.setProperty('--shuffle-delay',`${index*38}ms`);
    b.style.setProperty('--hand-x',`${Math.round(spread*7)}px`);
    b.style.setProperty('--hand-r',`${Math.round(spread*2)}deg`);
    b.style.setProperty('--hand-return-x',`${Math.round(spread*-8)}px`);
    b.style.setProperty('--hand-return-r',`${Math.round(spread*-3)}deg`);
    b.style.setProperty('--converge-x',`${Math.round((2.5-spread)*22)}px`);
    b.style.setProperty('--converge-mid-x',`${Math.round((2.5-spread)*13)}px`);
    b.style.setProperty('--converge-y',index%2?'18px':'-18px');
    b.style.setProperty('--converge-r',`${Math.round(spread*7)}deg`);
    b.setAttribute('aria-label',`种子 ${index+1} ${symbol}`);
    b.innerHTML=`<span class="seed-card-inner"><span class="seed-card-face seed-card-front" aria-hidden="true"></span><span class="seed-card-face seed-card-back" aria-hidden="true">${symbol}</span></span>`;
    b.onclick=()=>selectSeed(index,b); deck.append(b);
  });
}
function runShuffle(mode=state.shuffleMode){
  const deck=$('seedDeck');if(!deck)return;
  state.shuffleMode=mode;deck.dataset.shuffle=mode;deck.classList.remove('is-animating');
  void deck.offsetWidth;deck.classList.add('is-animating');
  clearTimeout(state.shuffleTimer);state.shuffleTimer=setTimeout(()=>deck.classList.remove('is-animating'),2100);
}
function startShuffle(){
  if(state.shuffleStarted)return;
  state.shuffleStarted=true;const deck=$('seedDeck');deck.classList.add('is-started');
  deck.querySelectorAll('.seed-card').forEach(card=>{card.disabled=false});
  $('startShuffle').disabled=true;
  document.querySelectorAll('.shuffle-mode').forEach(button=>{button.disabled=true;button.classList.toggle('is-active',button.dataset.shuffleMode===state.shuffleMode)});
  $('status').textContent='';runShuffle();
}
function selectSeed(index,node){
  if(state.stage!=='input'||!state.shuffleStarted||node.classList.contains('chosen')||(state.growth!==null&&state.relation!==null))return;
  node.classList.add('chosen');
  const value=index+1;
  if(HIDDEN_CARD_IDS.has(CARDS[index].id))node.classList.add('hidden-seed');
  if(state.growth===null){state.growth=value;$('seedOne').textContent=seedSymbols[index];$('status').textContent='第一颗种子已翻开。再选一颗，让它们相遇。';}
  else if(state.relation===null){state.relation=value;state.hiddenPair=isHiddenPair(CARDS[state.growth-1].id,CARDS[index].id);$('seedTwo').textContent=seedSymbols[index];if(state.hiddenPair){document.body.dataset.hiddenPair='true';document.querySelectorAll('.seed-card.chosen').forEach(card=>card.classList.add('hidden-pair'));$('status').textContent='隐藏配对已出现。';}else $('status').textContent='两颗种子已相遇，可以生成钥匙。';$('lockInput').disabled=false;}
}
function createArtwork(card,key){const c=document.createElement('canvas');c.width=720;c.height=960;const x=c.getContext('2d');const bg=x.createLinearGradient(0,0,720,960);bg.addColorStop(0,'#fffefa');bg.addColorStop(.5,'#f4eef9');bg.addColorStop(1,'#e9e0f5');x.fillStyle=bg;x.fillRect(0,0,720,960);const glow=x.createRadialGradient(360,420,18,360,420,320);glow.addColorStop(0,`${card.color}78`);glow.addColorStop(.38,`${card.color}30`);glow.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=glow;x.fillRect(30,30,660,900);x.strokeStyle='#b9aaf0';x.lineWidth=6;x.strokeRect(28,28,664,904);x.strokeStyle='rgba(116,91,145,.38)';x.lineWidth=2;x.strokeRect(48,48,624,864);x.fillStyle='#725b8e';x.font='28px monospace';x.fillText(card.id,72,102);x.textAlign='right';x.fillStyle='rgba(114,91,142,.7)';x.font='22px monospace';x.fillText(key.replaceAll(' · ','  '),648,102);x.textAlign='center';x.fillStyle='#73598e';x.shadowColor=card.color;x.shadowBlur=46;x.font='190px Georgia';x.fillText(card.symbol,360,500);x.shadowBlur=0;x.fillStyle='#73598e';x.font='bold 42px monospace';x.fillText(card.symbol,360,810);return c.toDataURL('image/png')}
async function preGenerateArtwork(card,key){const generation=state.generation;generation.status='generating';generation.progress=0;generation.job=null;generation.imageUrl=createArtwork(card,key);$('generatedArt').src=generation.imageUrl;$('generatedArt').hidden=false;$('generationCopy').textContent='作品正在后台生成；找到卡片时会提前就绪。';if(await backendReady()){try{const requestId=crypto.randomUUID?.()??`${state.job}-${Date.now()}`;const created=await createJob([state.growth,state.relation],requestId);const started=performance.now();const done=await waitForJob(created.id,job=>{generation.progress=Math.min(.95,(performance.now()-started)/6000);$('generationProgress').style.width=`${Math.round(generation.progress*100)}%`;$('generationPercent').textContent=`${Math.round(generation.progress*100)}%`});if(done.status!=='ready')throw Error(done.error||'作品生成失败');generation.job=done;generation.imageUrl=done.image;$('generatedArt').src=done.image;generation.progress=1;$('generationProgress').style.width='100%';$('generationPercent').textContent='100%';generation.status='ready';$('generationCopy').textContent='作品已生成，等待实体确认。';if(state.stage==='printing')preparePrinterScene();return}catch(error){$('generationCopy').textContent='作品服务暂时不可用，保留本地预生成图。'}}const started=performance.now();function tick(now){generation.progress=Math.min(1,(now-started)/3200);$('generationProgress').style.width=`${Math.round(generation.progress*100)}%`;$('generationPercent').textContent=`${Math.round(generation.progress*100)}%`;if(generation.progress<1)requestAnimationFrame(tick);else{generation.status='ready';$('generationCopy').textContent='作品已生成，等待实体确认。'}}requestAnimationFrame(tick)}
function makeKey(){const n=(state.growth*7+state.relation*11)%12;state.answerId=n;state.job=`JOB-${Date.now().toString(36).slice(-5).toUpperCase()}`;$('jobText').textContent=state.job;const key=`${seedSymbols[state.growth-1]} · ${seedSymbols[state.relation-1]} · ${String(n+1).padStart(2,'0')}`;$('keyGlyph').textContent=key;if(state.hiddenPair)$('keyGlyph').classList.add('hidden-key');$('targetHint').textContent=`${String(n+1).padStart(2,'0')} · ${CARDS[n].symbol}`;syncPhone('key-generated',{job:state.job,key,answerId:CARDS[n].id,hidden:state.hiddenPair});preGenerateArtwork(CARDS[n],key);$('status').textContent='钥匙已生成，作品已先行后台生成。带着线索去答案墙找卡片。';setStage('key')}
function renderCards(){const grid=$('cardGrid');grid.innerHTML='';CARDS.forEach((card,i)=>{const b=document.createElement('button');b.className='card';if(state.hiddenPair&&i===state.answerId)b.classList.add('hidden-fusion');b.setAttribute('aria-label',`${card.id} ${card.name}`);b.innerHTML=`<span class="num">${card.id}</span><span class="symbol" aria-hidden="true">${card.symbol}</span><span class="name">${card.name}</span><span class="card-tag">NFC</span>`;b.onclick=()=>{if(state.paired)return;state.selected=i;document.querySelectorAll('.card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$('scanCard').disabled=false;$('manualCard').disabled=false;$('scanStatus').textContent=`已选择 ${card.id} · ${card.name}，等待实体确认。`;$('scanStatus').style.color='';cardMeshes.forEach((m,j)=>m.scale.setScalar(j===i?1.18:1));};grid.append(b)})}
function scan(method='nfc'){if(state.selected==null||state.paired)return;if(state.selected!==state.answerId){$('scanStatus').textContent=`${method==='manual'?'电脑确认':'NFC'}：不匹配。钥匙还在寻找另一张卡。`;$('scanStatus').style.color='#b66b69';return}$('scanStatus').textContent=`${method==='manual'?'电脑确认':'NFC'}：匹配成功。等待配对。`;$('scanStatus').style.color='#5d8a6b';syncPhone('card-synced',{cardId:CARDS[state.selected].id,source:method});$('scanCard').disabled=true;$('manualCard').disabled=true;$('pairButton').hidden=false;document.querySelector('.cards-panel').classList.add('matched');}
function syncPhone(type,payload={}){const message={type:`between:${type}`,...payload};window.parent!==window&&window.parent.postMessage(message,location.origin);window.opener?.postMessage(message,location.origin);window.dispatchEvent(new CustomEvent('between-sync',{detail:message}))}
function startFusion(){if(state.selected!==state.answerId||state.paired)return;state.paired=true;syncPhone('pairing',{cardId:CARDS[state.selected].id});$('pairButton').hidden=true;document.querySelector('.cards-panel').classList.add('is-pairing');$('scanStatus').textContent='';setTimeout(()=>{document.querySelector('.cards-panel').classList.remove('is-pairing');showPrintReady()},2600)}
function showPrintProgress(p){$('printProgress').style.width=`${Math.round(p*100)}%`;$('percentText').textContent=`${Math.round(p*100)}%`;$('layerText').textContent=p<1?`${Math.max(1,Math.floor(p*38))} / 38`:'✓'}
// Paper leaves the printer while the 3D scene plays. ✓ reports what CUPS accepted (queued, not proof of paper out); × marks a print that did not queue.
// Direct IPP jobs wait for the printer to report the sheet out (◌ → ✓); CUPS fallback jobs can only confirm the queue. × marks a print that failed or is uncertain.
async function finishPrint(){const job=state.generation.job,card=CARDS[state.answerId];setStage('done');showPrintProgress(1);$('printTitle').textContent='✓';$('restart').hidden=false;if(!job){$('printTitle').setAttribute('aria-label','作品完成，可以取出');$('printCopy').textContent=`${card.id} · ${card.name} 已发送至小米打印机。`;return}let print=await state.print;if(print?.print_path==='ipp-direct'&&['submitted','printing'].includes(print.print_status)){$('layerText').textContent='◌';print=await waitForPaper(job.id).catch(()=>print)}const printed=print?.print_status==='printed',queued=['submitted','printing'].includes(print?.print_status);$('layerText').textContent=printed?'✓':queued?'◌':'×';$('printTitle').setAttribute('aria-label',printed?'作品已出纸，请取件':queued?'作品已交给打印机，请取件':'作品已归档，打印未完成');$('printCopy').textContent=`${card.id} · ${card.name} · ${job.id} `+(printed?`已从 ${print.printer} 出纸，请取件。`:queued?`已交给打印机 ${print.printer}${print.cups_job_id?`（队列 ${print.cups_job_id}）`:''}，请到打印机取件。`:print?.print_status==='no_printer'?'已归档；没有找到纸张打印机。':`已归档；打印未完成：${print?.print_error||print?.print_status||'未提交'}`)}
function preparePrinterScene(){const job=state.generation.job;if(!job||state.printerView||state.printerFailed)return;state.printerView=mountPrinterScene(job,{parent:$('scene').parentElement,onProgress:showPrintProgress,onComplete:finishPrint,onError:()=>{state.printerFailed=true;state.printerView?.close();state.printerView=null;root.visible=true;if(state.stage==='printing'&&$('startPrintButton').hidden)simulatePrint()}})}
function showPrintReady(){setStage('printing');$('printTitle').textContent='▧';$('printTitle').setAttribute('aria-label','作品已就绪，等待打印');$('printCopy').textContent=`${state.job} · 预生成图已缓存，点击后发送到小米打印机。`;$('printArt').src=state.generation.imageUrl||createArtwork(CARDS[state.answerId],'cached');$('printArt').hidden=false;$('startPrintButton').hidden=false;$('restart').hidden=true;$('printProgress').style.width='0%';$('percentText').textContent='0%';$('layerText').textContent='◌';preparePrinterScene()}
function startPrint(){setStage('printing');$('printTitle').textContent='⟶';$('printTitle').setAttribute('aria-label','正在发送到小米打印机');$('printCopy').textContent=`${state.job} · 使用已预生成作品，立即进入打印队列。`;$('printArt').src=state.generation.imageUrl||createArtwork(CARDS[state.answerId],'cached');$('printArt').hidden=false;$('startPrintButton').hidden=true;$('restart').hidden=true;state.progress=0;const job=state.generation.job;if(job)state.print=submitPrint(job).catch(error=>({print_status:'failed',print_error:error.message}));preparePrinterScene();if(state.printerView){root.visible=false;state.printerView.start()}else simulatePrint()}
function simulatePrint(){const started=performance.now();function step(now){state.progress=Math.min(1,(now-started)/8500);const p=state.progress;printObj.scale.setScalar(.05+p*.95);nozzle.position.x=-.9+p*1.7;showPrintProgress(p);if(p<1)requestAnimationFrame(step);else finishPrint()}requestAnimationFrame(step)}
window.addEventListener('message',event=>{if(event.origin!==location.origin)return;const data=event.data||{};if(data.type==='between:phone-card'&&state.stage==='cards'){const index=CARDS.findIndex(card=>card.id===String(data.cardId).padStart(2,'0'));if(index>=0){state.selected=index;document.querySelectorAll('.card').forEach((card,i)=>card.classList.toggle('selected',i===index));$('scanCard').disabled=false;$('manualCard').disabled=false;scan('nfc')}}if(data.type==='between:phone-pair')startFusion()});
$('lockInput').onclick=makeKey;$('openCards').onclick=()=>{renderCards();setStage('cards')};$('scanCard').onclick=()=>scan('nfc');$('manualCard').onclick=()=>scan('manual');$('pairButton').onclick=startFusion;$('startPrintButton').onclick=startPrint;$('restart').onclick=()=>{location.reload()};$('startShuffle').onclick=startShuffle;document.querySelectorAll('.shuffle-mode').forEach(button=>button.onclick=()=>{if(state.shuffleStarted)return;state.shuffleMode=button.dataset.shuffleMode;document.querySelectorAll('.shuffle-mode').forEach(item=>item.classList.toggle('is-active',item===button));runShuffle(state.shuffleMode)});renderSeedDeck();setStage('input');
function loop(now){printer.rotation.y=Math.sin(now*.0004)*.02;wall.rotation.y=Math.sin(now*.00025)*.025;printObj.rotation.y+=.006;if(renderer)renderer.render(scene,camera);requestAnimationFrame(loop)}requestAnimationFrame(loop);
