const stylesheet=document.createElement('link');
stylesheet.rel='stylesheet';stylesheet.href=new URL('./card-handoff.css',import.meta.url).href;document.head.append(stylesheet);
let active=null;
export function cancelCardHandoff(){
  if(!active)return;
  active.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  active.remove();active=null;
}
export async function receivePhoneCard(cardId){
  cancelCardHandoff();
  const id=String(cardId).padStart(2,'0');
  const layer=document.createElement('div');layer.className='card-handoff';layer.setAttribute('role','status');layer.setAttribute('aria-label',`电脑正在接住手机送来的第 ${id} 张卡`);
  const card=document.createElement('img');card.className='card-handoff-card';card.src=`./assets/print-cards/${id}-seed.webp`;card.alt='';
  layer.append(card);document.body.append(layer);active=layer;
  try{
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      layer.animate([{opacity:0},{opacity:1}],{duration:200,fill:'both'});
      await card.animate([
        {transform:'translate3d(0,38vh,-180px) scale(.48) rotateX(28deg)',opacity:1,offset:0},
        {transform:'translate3d(0,30vh,-80px) scale(.8) rotateX(12deg)',opacity:1,offset:.42},
        {transform:'translate3d(0,0,0) scale(1) rotateX(0deg)',opacity:1,offset:1}
      ],{duration:700,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}).finished;
    }
  }catch{}finally{layer.remove();if(active===layer)active=null;}
}
