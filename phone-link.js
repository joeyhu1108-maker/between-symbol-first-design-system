import {CARDS,getCard} from './game-cards.js';

// A tap on a physical card (the player's phone opens /t/NN) reaches this console through the Cloudflare relay in worker/index.js.
// The console flow stays in prototype-3d.js: the tap enters through the `between:phone-card` / `between:phone-pair` messages it
// already listens for. This module adds only the phone → screen arrival and the AI's card.

const RELAY_KEY='between.relay';
// The Cloudflare deployment, so a console served by printer/server.py (needed for real printing) still reaches the relay.
const DEPLOYED_RELAY='https://between.ycy-466.workers.dev';
// Keep aligned with prototype-3d.js and printer/rarity.py.
const HIDDEN_PAIRS=[['01','02'],['11','12']];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

// Deployed pages use their own origin; a local console takes ?relay=<origin> once and remembers it.
function relayOrigin(){
  const asked=new URLSearchParams(location.search).get('relay');
  if(asked){try{localStorage.setItem(RELAY_KEY,asked)}catch{}return asked}
  if(!['localhost','127.0.0.1'].includes(location.hostname))return location.origin;
  try{return localStorage.getItem(RELAY_KEY)||DEPLOYED_RELAY}catch{return DEPLOYED_RELAY}
}

const style=document.createElement('style');
style.textContent=`
.phone-link-layer{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;gap:clamp(18px,4vw,56px);pointer-events:none;background:rgba(255,255,255,.86);backdrop-filter:blur(3px);perspective:1200px;animation:pl-veil .35s ease both}
.phone-link-layer.is-leaving{animation:pl-out .45s ease forwards}
.phone-link-slot{position:relative;width:clamp(130px,15vw,200px)}
.phone-link-slot .card{display:block;width:100%;min-height:0!important;cursor:default;transform:none!important}
.phone-link-slot .card .symbol{font-size:clamp(56px,6vw,84px)}
.phone-link-slot .card:after{animation:pl-sheen 1s ease 1.3s both}
.phone-link-slot.you{animation:pl-rise 1.05s cubic-bezier(.18,.9,.25,1.12) .3s both}
.phone-link-slot.you:before{content:'';position:absolute;left:18%;right:18%;top:70%;height:70vh;background:linear-gradient(to bottom,rgba(169,137,219,.45),transparent);filter:blur(12px);animation:pl-trail 1.05s ease .3s both}
.phone-link-slot.ai{animation:pl-pop .9s cubic-bezier(.2,1.4,.3,1) 1.25s both}
.phone-link-slot.ai:before{content:'';position:absolute;inset:-25%;border-radius:50%;border:2px solid rgba(169,137,219,.6);animation:pl-ring .9s ease-out 1.3s both}
.phone-link-tag{display:block;margin-top:12px;text-align:center;font:10px monospace;letter-spacing:.3em;color:#8f6da4}
.phone-link-layer.is-hidden-pair .phone-link-tag{color:#9a6a1f}
.phone-link-dot{position:fixed;z-index:4;left:50%;bottom:20px;transform:translateX(-50%);font:14px SerifLocal,serif;color:#d3cadb;transition:color .3s}
.phone-link-dot[data-state=online]{color:#8f6da4;text-shadow:0 0 10px rgba(169,137,219,.6)}
@keyframes pl-veil{from{opacity:0}}
@keyframes pl-out{to{opacity:0;transform:scale(.97)}}
@keyframes pl-rise{0%{opacity:0;transform:translateY(75vh) rotateX(62deg) scale(.5)}55%{opacity:1}100%{transform:none}}
@keyframes pl-trail{0%{opacity:0}35%{opacity:1}100%{opacity:0;transform:scaleY(.15);transform-origin:top}}
@keyframes pl-pop{0%{opacity:0;transform:scale(.2) rotateY(-180deg)}100%{opacity:1;transform:none}}
@keyframes pl-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.4)}}
@keyframes pl-sheen{from{transform:translateX(-120%) rotate(10deg)}to{transform:translateX(120%) rotate(10deg)}}
@media(prefers-reduced-motion:reduce){.phone-link-layer,.phone-link-slot,.phone-link-slot:before,.phone-link-slot .card:after{animation-duration:.01s!important;animation-delay:0s!important}}`;
document.head.append(style);

const dot=document.createElement('span');
dot.className='phone-link-dot';dot.textContent='⌁';document.body.append(dot);
function setLink(state){
  const label={online:'手机碰卡：已连接',offline:'手机碰卡：未连接',off:'手机碰卡：没有配置中继'}[state];
  dot.dataset.state=state;dot.title=label;dot.setAttribute('aria-label',label);
}

function pickAiCard(card){
  const others=CARDS.filter(c=>c.id!==card.id),r=new Uint32Array(1);
  crypto.getRandomValues(r);return others[r[0]%others.length];
}
function selectedCardId(){
  const i=[...document.querySelectorAll('#cardGrid .card')].findIndex(node=>node.classList.contains('selected'));
  return i<0?null:CARDS[i].id;
}
function post(data){window.dispatchEvent(new MessageEvent('message',{data,origin:location.origin}))}

function slot(card,role,hidden){
  const node=document.createElement('div');node.className=`phone-link-slot ${role}`;
  node.innerHTML=`<div class="card${hidden?' hidden-fusion':''}"><span class="num">${card.id}</span><span class="symbol" aria-hidden="true">${card.symbol}</span></div><span class="phone-link-tag">${role==='you'?'YOU':'AI'}</span>`;
  return node;
}
// The player's card rises from below the screen (from the phone), then the AI's card pops out beside it.
function playArrival(card,ai){
  const hidden=HIDDEN_PAIRS.some(pair=>pair.includes(card.id)&&pair.includes(ai.id));
  const layer=document.createElement('div');
  layer.className=`phone-link-layer${hidden?' is-hidden-pair':''}`;layer.setAttribute('role','status');
  layer.setAttribute('aria-label',`实体卡 ${card.id} ${card.name} 已从手机送达；AI 选择了 ${ai.id} ${ai.name}`);
  layer.append(slot(card,'you',hidden),slot(ai,'ai',hidden));document.body.append(layer);
  return new Promise(resolve=>setTimeout(()=>{layer.classList.add('is-leaving');setTimeout(()=>{layer.remove();resolve()},reduced?0:450)},reduced?900:2700));
}

let busy=false;
async function onTap(cardId){
  const card=getCard(cardId);
  if(!card)return {status:'bad_card'};
  // A tap while the key is showing opens the answer wall first.
  if(document.body.dataset.stage==='key')document.getElementById('openCards')?.click();
  const panel=document.querySelector('.cards-panel');
  if(busy||document.body.dataset.stage!=='cards'||!panel||panel.classList.contains('is-pairing'))return {status:'idle',card:card.id};
  // The console's own NFC path selects the card and checks it against the target; it marks a match with .matched.
  if(!panel.classList.contains('matched'))post({type:'between:phone-card',cardId:card.id});
  if(!panel.classList.contains('matched')||selectedCardId()!==card.id)return {status:'wrong',card:card.id};
  busy=true;
  const ai=pickAiCard(card);
  // Answer the phone right away so its card leaves the phone as this one arrives.
  playArrival(card,ai).then(()=>{
    post({type:'between:phone-pair',cardId:card.id,aiCardId:ai.id});
    window.dispatchEvent(new CustomEvent('between-pair',{detail:{card:card.id,ai:ai.id}}));
    busy=false;
  });
  return {status:'matched',card:card.id,ai:ai.id};
}

function connect(origin){
  const url=`${origin.replace(/^http/,'ws')}/api/relay/console`;
  let retry=1000,ping=null;
  (function open(){
    const ws=new WebSocket(url);
    ws.onopen=()=>{retry=1000;setLink('online');ping=setInterval(()=>ws.readyState===WebSocket.OPEN&&ws.send('ping'),20000)};
    ws.onmessage=async event=>{
      if(event.data==='pong')return;
      let message;try{message=JSON.parse(event.data)}catch{return}
      if(message.type!=='tap')return;
      const ack=await onTap(message.card);
      try{ws.send(JSON.stringify({type:'ack',id:message.id,...ack}))}catch{}
    };
    ws.onclose=()=>{clearInterval(ping);setLink('offline');setTimeout(open,retry);retry=Math.min(retry*2,15000)};
  })();
}

const origin=relayOrigin();
if(origin)connect(origin);else setLink('off');
