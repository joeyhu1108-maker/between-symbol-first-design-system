const stylesheet=document.createElement('link');
stylesheet.rel='stylesheet';stylesheet.href=new URL('./waiting-shuffle.css',import.meta.url).href;document.head.append(stylesheet);

const face=id=>new URL(`./assets/print-cards/${String(id).padStart(2,'0')}-seed.webp`,import.meta.url).href;
export function mountWaitingShuffle(parent){
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const root=document.createElement('div');root.className='waiting-shuffle';root.setAttribute('aria-hidden','true');
  const cards=Array.from({length:5},(_,index)=>{
    const card=document.createElement('img');card.className='waiting-shuffle-card';card.alt='';card.draggable=false;card.style.zIndex=String(index+1);root.append(card);return card;
  });
  parent.prepend(root);
  let timer=null,running=false,version=0,previous=[],cursor=cards.length-1,shuffling=false;
  const animations=new Set();
  const randomCards=()=>{
    const ids=Array.from({length:12},(_,index)=>index+1);
    for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
    if(ids[4]===previous[4])[ids[4],ids[5]]=[ids[5],ids[4]];
    return ids.slice(0,5);
  };
  function pose(index){
    return `translate3d(${[-68,-34,0,34,68][index]}px,${[18,5,0,5,18][index]}px,0) rotate(${[-12,-6,0,6,12][index]}deg)`;
  }
  async function animate(card,frames,options){
    const animation=card.animate(frames,options);animations.add(animation);
    try{await animation.finished;}catch{}finally{animations.delete(animation);animation.cancel();}
  }
  async function shuffle(){
    if(!running||shuffling)return;
    const current=version,index=cursor,card=cards[index],rest=pose(index),ids=previous.slice();
    const available=Array.from({length:12},(_,i)=>i+1).filter(id=>!previous.includes(id));
    ids[index]=available[Math.floor(Math.random()*available.length)];cursor=(cursor-1+cards.length)%cards.length;
    root.dataset.cycle=String(Number(root.dataset.cycle||0)+1);
    if(reducedMotion.matches){
      card.src=face(ids[index]);previous=ids;return;
    }
    shuffling=true;
    try{
      await animate(card,[{transform:rest,opacity:1},{transform:`${rest} translateY(-34px) rotateY(84deg)`,opacity:.45}],{duration:220,easing:'ease-in',fill:'forwards'});
      if(!running||version!==current)return;
      card.src=face(ids[index]);
      await animate(card,[{transform:`${rest} translateY(-34px) rotateY(-84deg)`,opacity:.45},{transform:rest,opacity:1}],{duration:440,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
      if(running&&version===current)previous=ids;
    }finally{if(version===current)shuffling=false;}
  }
  function start(){
    if(running)return;running=true;version++;cursor=cards.length-1;shuffling=false;root.hidden=false;previous=randomCards();
    cards.forEach((card,index)=>{card.src=face(previous[index]);card.style.transform=pose(index);});
    timer=setInterval(shuffle,1700);
  }
  function stop(){
    running=false;version++;shuffling=false;clearInterval(timer);timer=null;
    animations.forEach(animation=>animation.cancel());animations.clear();
    cards.forEach(card=>card.getAnimations().forEach(animation=>animation.cancel()));root.hidden=true;
  }
  for(let id=1;id<=12;id++){const image=new Image();image.src=face(id);}
  start();return {start,stop,destroy(){stop();root.remove();}};
}
