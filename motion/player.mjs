export const segments={idle:[0,240],hover:[240,288],tap:[288,396]};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const cache=new Map();
export async function createSymbol(container,id,{ambient=false,ambientState='idle',interactive=true}={}){
 const url=new URL(`./animations/${id}.json`,import.meta.url).href;
 if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Symbol could not load');return r.json()}));
 const animation=window.lottie.loadAnimation({container,renderer:'svg',autoplay:false,loop:false,animationData:structuredClone(await cache.get(url)),rendererSettings:{preserveAspectRatio:'xMidYMid meet',progressiveLoad:false}});
 await new Promise(resolve=>{if(animation.isLoaded)resolve();else animation.addEventListener('DOMLoaded',resolve)});
 let state='static',speed=1,visible=true,pending=null,settling=false,destroyed=false,manuallyPaused=false;
 const controller={animation,
  play(next='tap'){
   if(destroyed)return;
   manuallyPaused=false;
   if(reduced.matches){controller.static();return;}
   if(next===state&&state!=='idle')return;
   // Finish the current gesture before the next, with at most 120 ms of return.
   if(state!=='static'&&!animation.isPaused){
    pending=next;
    if(settling)return;
    settling=true;animation.loop=false;
    const remaining=animation.totalFrames-animation.currentFrame;
    animation.setSpeed(Math.max(speed,remaining/7.2));
   }else start(next);
  },
  pause(){manuallyPaused=true;animation.pause();},
  resume(){manuallyPaused=false;visibility();},
  static(){pending=null;settling=false;state='static';animation.resetSegments(true);animation.goToAndStop(396,true);container.dataset.state='static';},
  seek(ms){controller.static();animation.goToAndStop(288+Math.max(0,Math.min(ms,1800))*.06,true);container.dataset.state='tap';},
  setSpeed(value){speed=value;if(!settling)animation.setSpeed(value);},
  destroy(){destroyed=true;observer.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motionChange);animation.destroy();},
  get state(){return state;}
 };
 function start(next){state=next;settling=false;pending=null;container.dataset.state=next;animation.setDirection(1);animation.setSpeed(speed);animation.loop=next===ambientState&&ambient;animation.playSegments(segments[next],true);}
 animation.addEventListener('complete',()=>{const next=pending;state='static';settling=false;if(next)start(next);else if(ambient&&visible&&!document.hidden&&!reduced.matches)start(ambientState);else controller.static();});
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;visibility();},{threshold:0.05});observer.observe(container);
 function visibility(){if(manuallyPaused||!visible||document.hidden)animation.pause();else if(state!=='static'&&!reduced.matches)animation.play();else if(ambient&&!reduced.matches)start(ambientState);}
 function motionChange(){if(reduced.matches)controller.static();else visibility();}
 document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motionChange);
 if(interactive){container.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')controller.play('hover');});container.addEventListener('click',()=>controller.play('tap'));container.addEventListener('focus',()=>controller.play('hover'));}
 if(ambient&&!reduced.matches)start(ambientState);else controller.static();
 return controller;
}
