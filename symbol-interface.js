import {createSymbol} from './motion/player.mjs';

// Interface controls have their own vocabulary; 01–12 remain card identities.
const controlIcons={
  handoff:'<rect x="5" y="7" width="13" height="25" rx="2"/><path d="m10 19 2-3 2 3-2 3Z"/><path class="control-shift" d="M23 20h11m-5-5 5 5-5 5"/>',
  restart:'<path class="control-shift" d="M9 12a13 13 0 1 1-2 13M9 5v8H2"/><path class="control-accent" d="M20 27v-7m0 2c-5 0-7-3-7-6 5 0 7 2 7 6Zm0-3c0-4 3-6 7-6 0 4-3 6-7 6Z"/>',
  print:'<path d="M12 13V5h16v8M12 28H6V14h28v14h-6"/><path class="control-shift" d="M12 23h16v12H12zM16 28h8m-8 3h8"/><circle class="control-accent" cx="28" cy="18" r="1"/>',
  back:'<path class="control-shift" d="M24 12 16 20l8 8M16 20h17"/><path d="M10 9v22"/>',
  hand:'<g class="control-fan-left"><rect x="8" y="12" width="13" height="20" rx="2" transform="rotate(-18 14.5 22)"/></g><g class="control-fan-right"><rect x="19" y="12" width="13" height="20" rx="2" transform="rotate(18 25.5 22)"/></g><rect x="13.5" y="8" width="13" height="21" rx="2" fill="var(--paper)"/><path class="control-accent" d="M18 23h4"/>',
  slot:'<rect x="6" y="9" width="28" height="23" rx="3"/><path d="M15.5 10v21m9-21v21"/><g class="control-reels"><path d="M9 16h3m6 9h4m6-10h3"/><path class="control-accent" d="M18 20h4"/></g><path d="M11 5h18"/>',
  converge:'<g class="control-inward-left"><path d="M6 13v-3a2 2 0 0 1 2-2h5M7 14l8 7m-4 0h4v-4"/></g><g class="control-inward-right"><path d="M27 8h5a2 2 0 0 1 2 2v3m-1 1-8 7m0-4v4h4"/></g><path d="M17 5h6v8h-6z"/><rect class="control-accent" x="14" y="25" width="12" height="10" rx="2"/>',
  shuffle:'<g class="control-cross"><path d="M6 11h4c8 0 11 18 19 18h5M6 29h4c3 0 5-3 8-7m4-6c2-3 4-5 7-5h5"/><path class="control-accent" d="m29 6 5 5-5 5m0 8 5 5-5 5"/></g>'
};
function mountControlIcon(host,name,content=controlIcons[name]){
  if(!host)return;
  unmountGlyph(host);host.classList.remove('has-glyph');host.dataset.controlIcon=name;
  host.innerHTML=`<svg class="control-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}

const mounts=new WeakMap(),loaders=new WeakMap();
export function unmountGlyph(host){
  const loading=loaders.get(host);
  if(loading){loaders.delete(host);loading.destroy();}
  const mounted=mounts.get(host);
  if(!mounted)return;
  mounted.cancelled=true;mounted.player?.destroy();mounted.events?.abort();mounts.delete(host);
}
export function mountGlyph(host,id,{ambient=false,interactive=false,intro=false}={}){
  if(!host)return;
  const key=`${id}:${ambient}:${interactive}:${intro}`,previous=mounts.get(host);
  if(previous?.key===key&&host.contains(previous.wrapper))return;
  host.querySelectorAll('.state-glyph').forEach(unmountGlyph);
  unmountGlyph(host);
  const wrapper=document.createElement('span');wrapper.className='interface-glyph';wrapper.dataset.symbolId=id;wrapper.setAttribute('aria-hidden','true');
  const fallback=document.createElement('img');fallback.src=new URL(`./motion/vectors/${id}.svg`,import.meta.url).href;fallback.alt='';fallback.draggable=false;
  const canvas=document.createElement('span');canvas.className='glyph-render';
  wrapper.append(fallback,canvas);host.replaceChildren(wrapper);host.classList.add('has-glyph');
  const mounted={key,wrapper,cancelled:false,player:null,events:new AbortController()};mounts.set(host,mounted);
  if(interactive){
    const play=state=>{if(!host.disabled)mounted.player?.play(state);};
    host.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')play('hover');},{signal:mounted.events.signal});
    host.addEventListener('focusin',()=>play('hover'),{signal:mounted.events.signal});
    host.addEventListener('click',()=>play('tap'),{signal:mounted.events.signal,capture:true});
  }
  createSymbol(canvas,id,{ambient,ambientState:'tap',interactive:false}).then(player=>{
    if(mounted.cancelled||!host.contains(wrapper)){player.destroy();return;}
    mounted.player=player;fallback.remove();wrapper.dataset.ready='true';
    if(intro)player.play('tap');
  }).catch(()=>canvas.remove());
}
export function actionGlyph(host,id){
  if(!host)return;host.classList.add('symbol-action');
  const control={startShuffle:'shuffle',localEntry:'hand',retryEntry:'shuffle',lockInput:'handoff',restart:'restart',paperPrint:'print'}[host.id]||host.dataset.shuffleMode;
  if(control&&controlIcons[control])mountControlIcon(host,control);
  else mountGlyph(host,id,{interactive:true});
}
export function mountSymbolState(host,ids,active,{intro=false,ambient=active}={}){
  if(!host)return;
  const key=`${ids.join(',')}:${active}:${intro}:${ambient}`;
  if(host.dataset.symbolState===key&&host.querySelector('.state-glyph'))return;
  host.querySelectorAll('.state-glyph').forEach(unmountGlyph);unmountGlyph(host);host.replaceChildren();
  host.dataset.symbolState=key;host.dataset.active=String(active);host.setAttribute('aria-busy',String(active));
  ids.forEach(id=>{const node=document.createElement('span');node.className='state-glyph';host.append(node);mountGlyph(node,id,{ambient,intro});});
}
export function mountSymbolLoading(host,active=true){
  if(!host)return;
  if(active&&loaders.has(host))return;
  host.querySelectorAll('.state-glyph').forEach(unmountGlyph);unmountGlyph(host);host.replaceChildren();
  delete host.dataset.symbolState;host.classList.remove('has-glyph');
  host.dataset.active=String(active);host.setAttribute('aria-busy',String(active));
  if(!active)return;
  const node=document.createElement('span');node.className='state-glyph';host.append(node);
  const events=new AbortController(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let index=0,timer=null,visible=true,cancelled=false;
  const show=()=>{
    if(cancelled)return;
    const id=String(index+1).padStart(2,'0');host.dataset.symbolLoading=id;
    mountGlyph(node,id,{intro:true});
  };
  const schedule=()=>{
    clearTimeout(timer);
    if(cancelled)return;
    if(!host.isConnected){unmountGlyph(host);return;}
    if(!visible||document.hidden||reduced.matches)return;
    timer=setTimeout(()=>{index=(index+1)%12;show();schedule();},2000);
  };
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule();});
  loaders.set(host,{destroy(){
    cancelled=true;clearTimeout(timer);observer.disconnect();events.abort();unmountGlyph(node);
    delete host.dataset.symbolLoading;host.dataset.active='false';host.setAttribute('aria-busy','false');
  }});
  document.addEventListener('visibilitychange',schedule,{signal:events.signal});
  reduced.addEventListener('change',schedule,{signal:events.signal});
  window.addEventListener('pagehide',()=>{visible=false;schedule();},{signal:events.signal});
  window.addEventListener('pageshow',()=>{visible=host.getClientRects().length>0;schedule();},{signal:events.signal});
  show();observer.observe(host);schedule();
}
const stages={entry:[0,'等待你的卡片'],input:[1,'洗牌与抽卡'],selected:[1,'你的卡片'],ai:[2,'AI 正在回应'],key:[2,'两张卡共同生成花园'],cards:[2,'匹配并融合'],printing:[3,'作品生成与预演'],done:[3,'作品已保存']};
export function stageGlyph(stage){
  const [step,label]=stages[stage]||stages.entry,host=document.getElementById('stageLabel');
  const dots=[[20,7],[33,20],[20,33],[7,20]].map(([x,y],index)=>`<circle cx="${x}" cy="${y}" r="${index===step?2.7:1.6}" fill="${index===step?'var(--symbol-red)':'var(--muted)'}" stroke="var(--paper)" stroke-width="2"/>`).join('');
  mountControlIcon(host,'progress',`<circle cx="20" cy="20" r="13" stroke="var(--line)"/>${dots}${stage==='done'?'<path d="m15 20 3.5 3.5L25 17"/>':''}`);
  host?.setAttribute('aria-label',label);host?.setAttribute('title',label);host?.setAttribute('role','img');
}
export function mountMainInterface(){
  const $=id=>document.getElementById(id);
  mountControlIcon(document.querySelector('.brand'),'back');
  mountGlyph($('openingGlyph'),'01',{ambient:true});
  mountGlyph($('entryGlyph'),'01');
  const actions={retryEntry:'10',localEntry:'06',startShuffle:'06',lockInput:'07',retryGeneration:'06',openCards:'08',scanCard:'02',manualCard:'08',pairButton:'08',startPrintButton:'12',paperPrint:'12',restart:'10',downloadArtwork:'04',openPrinter:'05'};
  Object.entries(actions).forEach(([id,glyph])=>actionGlyph($(id),glyph));
  document.querySelectorAll('.shuffle-mode').forEach(button=>{
    actionGlyph(button);
    button.setAttribute('aria-pressed',String(button.classList.contains('is-active')));
  });
  document.querySelectorAll('[data-interface-glyph]').forEach(host=>mountGlyph(host,host.dataset.interfaceGlyph));
}
