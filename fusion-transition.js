import {mountGlyph,unmountGlyph} from './symbol-interface.js?v=loading-sequence-2';

let activeFusion;

const cardId=card=>{
  const id=String(card?.id??'').padStart(2,'0');
  if(!/^(0[1-9]|1[0-2])$/.test(id))throw new TypeError('Fusion requires an original card ID from 01 to 12.');
  return id;
};
const cardSource=id=>new URL(`./assets/print-cards/${id}-seed.webp`,import.meta.url).href;
const symbolSource=id=>new URL(`./motion/vectors/${id}.svg`,import.meta.url).href;
const signature=(id,side)=>`<span class="fusion-signature fusion-signature--${side}" data-symbol-id="${id}"></span>`;

// These symbols describe the encounter; they are not card identities or backend status.
function symbolStreams(){
  return Array.from({length:24},(_,index)=>{
    const humanSide=index%2===0;
    const x=(index%6-2.5)*64,y=(Math.floor(index/6)-1.5)*52;
    const edge=index%4,step=Math.floor(index/4)/5;
    const endX=edge<2?(step-.5)*210:edge===2?-105:105;
    const endY=edge===0?-44:edge===1?76:-44+step*120;
    const id=String(index%12+1).padStart(2,'0');
    return `<span class="fusion-symbol-thread" style="--source-x:${humanSide?-68:68}px;--thread-x:${x}px;--thread-y:${y}px;--edge-x:${endX}px;--edge-y:${endY}px;--thread-delay:${index%4*65}ms;--symbol-turn:${humanSide?-12:12}deg"><img src="${symbolSource(id)}" alt="" draggable="false"></span>`;
  }).join('');
}

/** Resolves true after the transition; false if the page leaves or a new run replaces it. */
export function playFusion({parent=document.body,humanCard,aiCard}={}){
  const human=cardId(humanCard),ai=cardId(aiCard);
  if(human===ai)throw new RangeError('The human and AI cards must be different.');
  activeFusion?.();
  const overlay=document.createElement('div');
  overlay.className='fusion-transition';
  overlay.dataset.humanCard=human;overlay.dataset.aiCard=ai;
  overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML=`<div class="fusion-transition-scene">
    <div class="fusion-original fusion-original--human"><img src="${cardSource(human)}" alt="" draggable="false"></div>
    <div class="fusion-original fusion-original--ai"><img src="${cardSource(ai)}" alt="" draggable="false"></div>
    <div class="fusion-signatures">${signature(human,'human')}${signature(ai,'ai')}</div>
    <div class="fusion-symbol-stream">${symbolStreams()}</div>
    <div class="fusion-glyph-core"><img src="${symbolSource('08')}" alt="" draggable="false"></div>
    <svg class="fusion-printer-outline" viewBox="-160 -150 320 300" aria-hidden="true">
      <path class="fusion-printer-paper" d="M-69-46v-81H69v81M-44-99h88m-88 16h69"/>
      <path class="fusion-printer-shell" d="M-72 76h-33V-28q0-16 16-16H89q16 0 16 16V76H72M-105 7h210M-72 43H72v89H-72Z"/>
      <path class="fusion-printer-detail" d="M-49 66h98m-98 18h69m-69 18h83M73-20h8"/>
      <path class="fusion-printer-scan" d="M-92 0H92"/>
    </svg>
  </div>`;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  overlay.dataset.reduced=String(motion.matches);
  parent.append(overlay);
  const glyphHost=overlay.querySelector('.fusion-glyph-core');
  const signatures=[...overlay.querySelectorAll('.fusion-signature')];
  signatures.forEach(host=>mountGlyph(host,host.dataset.symbolId,{ambient:true,intro:true}));
  mountGlyph(glyphHost,'08',{ambient:true});
  return new Promise(resolve=>{
    let timer,finished=false;
    const finish=completed=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      window.removeEventListener('pagehide',leave);
      motion.removeEventListener('change',reduceMotion);
      observer.disconnect();unmountGlyph(glyphHost);signatures.forEach(unmountGlyph);overlay.remove();
      if(activeFusion===leave)activeFusion=undefined;
      resolve(completed);
    };
    const leave=()=>finish(false);
    const reduceMotion=event=>{
      if(!event.matches)return;
      overlay.dataset.reduced='true';clearTimeout(timer);
      timer=setTimeout(()=>finish(true),1200);
    };
    const observer=new MutationObserver(()=>{if(!overlay.isConnected)finish(false);});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    window.addEventListener('pagehide',leave);
    motion.addEventListener('change',reduceMotion);
    activeFusion=leave;
    timer=setTimeout(()=>finish(true),motion.matches?1200:8600);
  });
}
