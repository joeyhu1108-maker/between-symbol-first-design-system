import {CARDS,getCard,createSession,addNutrient,releaseNutrient,advanceSession} from './game-cards.js';

const $=id=>document.getElementById(id),TAU=Math.PI*2;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const game={mode:'map',card:null,session:null,angle:-Math.PI/2,frame:0,completed:new Set()};
const stage=$('roulette-stage'),nodes=document.createElement('div'),ball=document.createElement('span');
nodes.id='fate-nodes';ball.id='roulette-ball';ball.setAttribute('aria-hidden','true');
stage.append(nodes,ball);
for(const card of CARDS){
  const node=document.createElement('button'),angle=(Number(card.id)-1)/12*TAU-Math.PI/2;
  node.type='button';node.className='fate-node';node.dataset.card=card.id;node.style.left=`${50+Math.cos(angle)*43}%`;node.style.top=`${50+Math.sin(angle)*43}%`;node.style.setProperty('--node-color',card.color);
  node.innerHTML=`<span class="node-number">${card.id}</span><span class="node-name">${card.name}</span>`;
  node.setAttribute('aria-label',`实体卡 ${card.id}，${card.name}，查看并进入`);
  node.addEventListener('click',()=>{if(game.mode==='drawing')return;reveal(card,'physical');});
  nodes.append(node);
}

function mode(value){game.mode=value;document.body.dataset.gameMode=value;window.__seedGameMode=value;nodes.querySelectorAll('button').forEach(node=>node.disabled=value==='drawing');}
function setText(id,value){if($(id))$(id).textContent=value;}
function placeBall(angle){game.angle=angle;ball.style.left=`${50+Math.cos(angle)*43}%`;ball.style.top=`${50+Math.sin(angle)*43}%`;}
function markCard(card){nodes.querySelectorAll('button').forEach(node=>{node.classList.toggle('selected',node.dataset.card===card?.id);node.setAttribute('aria-pressed',String(node.dataset.card===card?.id));});}
function reveal(card,source='wheel'){
  game.card=card;mode('revealed');markCard(card);placeBall((Number(card.id)-1)/12*TAU-Math.PI/2);
  document.body.style.setProperty('--card-color',card.color);
  setText('card-number',`${card.id} / ${card.element}`);setText('card-name',card.name);setText('card-prompt',card.question);setText('card-task',card.task);
  setText('game-step','02 / 把卡带入世界');setText('game-status',source==='physical'?`已选择实体卡 ${card.id}「${card.name}」。请确认与你手中的卡片一致。`:`轮盘为你停在 ${card.id}「${card.name}」。取走同编号实体卡，扫描卡上二维码进入。`);
  setText('draw-card','重新抽取');$('draw-card').disabled=false;$('enter-node').disabled=false;
  if($('card-scan-link')){$('card-scan-link').hidden=false;$('card-scan-link').href=`?card=${card.id}`;$('card-scan-link').textContent=`卡片入口 · ?card=${card.id}`;}
  if($('game-result'))$('game-result').hidden=true;
}

function drawCard(){
  if(game.mode==='drawing')return;
  cancelAnimationFrame(game.frame);mode('drawing');game.card=null;markCard(null);$('draw-card').disabled=true;$('enter-node').disabled=true;
  setText('game-step','01 / 抽取你的起点');setText('game-status','小球仍在寻找落点。此刻，你不知道自己将成为种子，还是养分。');
  const random=new Uint32Array(1);crypto.getRandomValues(random);const chosen=Math.floor(random[0]/4294967296*CARDS.length);
  const from=game.angle,target=chosen/12*TAU-Math.PI/2,travel=TAU*(reduced?1:5)+((target-from)%TAU+TAU)%TAU,duration=reduced?500:4100,start=performance.now();
  function spin(now){const q=Math.min(1,(now-start)/duration),ease=1-Math.pow(1-q,3.2);placeBall(from+travel*ease);
    const active=((Math.round((game.angle+Math.PI/2)/TAU*12)%12)+12)%12;
    nodes.querySelectorAll('button').forEach((node,i)=>node.classList.toggle('passing',i===active));
    if(q<1)game.frame=requestAnimationFrame(spin);else{nodes.querySelectorAll('button').forEach(node=>node.classList.remove('passing'));reveal(CARDS[chosen]);$('enter-node').focus({preventScroll:true});}
  }
  game.frame=requestAnimationFrame(spin);
}

function enter(card=game.card){
  if(!card)return;game.card=card;game.session=createSession(card,performance.now()/1000);mode('playing');
  document.querySelector('.eyebrow').textContent=`${card.id} / ${card.name} · ${card.element}`;
  document.querySelector('.dek').textContent=card.question;
  document.body.style.setProperty('--card-color',card.color);setText('game-step',`03 / ${card.id} · ${card.name}`);setText('game-status',card.task);
  setText('card-number',`${card.id} / ${card.element}`);setText('card-name',card.name);setText('card-prompt',card.question);setText('card-task',card.task);
  setText('node-progress-label',card.mechanic==='balance'?'适量区间 29%—71% · 照料 0 / 3':'关系正在开始 · 0%');
  if($('node-progress')){$('node-progress').value=0;$('node-progress').dataset.mechanic=card.mechanic;}
  if($('game-result'))$('game-result').hidden=true;
  window.__seedNodeHint=card.task;window.dispatchEvent(new CustomEvent('seed-game-enter',{detail:{card}}));$('universe').setAttribute('aria-label',`${card.name}节点。${card.task}也可按空格给予一份养分。`);$('universe').focus({preventScroll:true});
}

function renderProgress(){
  const s=game.session;if(!s)return;
  if($('node-progress'))$('node-progress').value=s.progress;
  setText('game-status',s.message);
  window.__seedNodeHint=s.message;
  setText('node-progress-label',s.card.mechanic==='balance'?`适量区间 29%—71% · 照料 ${s.rounds} / 3`:`${s.card.mechanic==='return'?'回赠':'生长'}进程 · ${Math.round(s.progress)}%`);
}
function finish(){
  mode('complete');game.completed.add(game.card.id);nodes.querySelector(`[data-card="${game.card.id}"]`)?.classList.add('completed');
  setText('game-step',`04 / 留下一次关系 · ${game.completed.size} / 12`);setText('game-status',game.card.result);
  if($('game-result')){$('game-result').hidden=false;$('game-result').textContent=`${game.card.id} · ${game.card.name} — ${game.card.result}`;}
  window.dispatchEvent(new CustomEvent('seed-game-complete',{detail:{card:game.card}}));
}
function leave(){
  game.session=null;mode('map');setText('game-step','01 / 抽取你的起点');setText('game-status',`已留下 ${game.completed.size} 段关系。抽取下一张，或选择与你手中实体卡一致的节点。`);
  document.querySelector('.eyebrow').textContent='十二张卡片 / 十二种相遇';document.querySelector('.dek').textContent='先让偶然替你选择一个入口。再用行动，决定关系如何生长。';window.__seedNodeHint=null;
  setText('draw-card','让小球选择');$('draw-card').disabled=false;if($('game-result'))$('game-result').hidden=true;window.dispatchEvent(new CustomEvent('seed-game-leave'));$('draw-card').focus({preventScroll:true});
}
$('draw-card').addEventListener('click',drawCard);$('enter-node').addEventListener('click',()=>enter());$('leave-node')?.addEventListener('click',leave);
window.addEventListener('nutrient',event=>{if(game.mode!=='playing')return;addNutrient(game.session,event.detail.amount);renderProgress();});
window.addEventListener('seed-release',()=>{if(game.mode!=='playing')return;releaseNutrient(game.session,performance.now()/1000);renderProgress();});
window.addEventListener('seed-game-restart',()=>{if(game.mode==='playing'||game.mode==='complete')enter(game.card);});
document.addEventListener('keydown',event=>{if(event.code==='Escape'&&(game.mode==='playing'||game.mode==='complete'))leave();});
function tick(now){if(game.mode==='playing'){const completed=advanceSession(game.session,now/1000);renderProgress();if(completed)finish();}requestAnimationFrame(tick);}
requestAnimationFrame(tick);placeBall(-Math.PI/2);mode('map');$('enter-node').disabled=true;
const query=new URLSearchParams(location.search),requested=query.get('card');
if(requested){const card=getCard(requested);if(card)enter(card);else setText('game-status','这张卡的编号无法识别。请核对实体卡上的 01—12 编号，或重新抽取。');}
