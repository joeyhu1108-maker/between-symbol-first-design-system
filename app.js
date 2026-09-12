const canvas=document.querySelector('#universe'),ctx=canvas.getContext('2d'),$=id=>document.getElementById(id),film=$('seed-film');
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU=Math.PI*2, clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), lerp=(a,b,t)=>a+(b-a)*t;
const hash=n=>{const x=Math.sin(n*127.1+91.7)*43758.5453;return x-Math.floor(x)};
const state={w:0,h:0,dpr:1,time:0,energy:.08,targetEnergy:.08,released:0,releasePulse:0,releaseUntil:0,feedPulse:0,coreFocus:0,lastTrailAt:0,lastFeedAt:0,phase:'seeking',cycle:0,suppressClick:false,pointer:{x:.5,y:.5,active:false,down:false},seedScale:1,seedTarget:1,observer:0,trail:[],particles:[],feedBeads:[],bursts:[],memories:[],stars:[]};
function resize(){const r=canvas.getBoundingClientRect();state.w=r.width;state.h=r.height;state.dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(state.w*state.dpr);canvas.height=Math.round(state.h*state.dpr);ctx.setTransform(state.dpr,0,0,state.dpr,0,0);state.stars=Array.from({length:420},(_,i)=>({x:hash(i*2.3),y:hash(i*5.7),r:.25+hash(i*8.1)*1.1,a:.1+hash(i*4.2)*.65,c:hash(i*3.9)>.91?'ember':'cyan'}));state.particles=Array.from({length:620},(_,i)=>({a:hash(i*2.1)*TAU,r:.1+hash(i*9.4)*.98,s:.18+hash(i*4.4)*.56,p:hash(i*7.8),size:.5+hash(i*3.1)*1.6,kind:hash(i*5.6)>.89?'ember':'dust'}));}
addEventListener('resize',resize);resize();
setInterval(()=>{window.__seedEnergy=state.energy;window.__seedReleased=state.released;window.__seedPointer=state.pointer;window.__seedPhase=state.phase;window.__seedFeedPulse=state.feedPulse},40);
film?.play().catch(()=>{});
function coreDistance(){const cx=state.w*.53+(state.pointer.x-.5)*-18,cy=state.h*.53+(state.pointer.y-.5)*-12;const dx=state.pointer.x*state.w-cx,dy=state.pointer.y*state.h-cy;return Math.hypot(dx,dy)/Math.min(state.w,state.h)}
const canInteract=()=>!window.__seedGameMode||window.__seedGameMode==='playing';
function emitNutrient(amount=.12,source='tap'){
  if(source!=='space'&&state.coreFocus<.16)return false;
  state.targetEnergy=clamp(state.targetEnergy+amount,0,1);state.released=clamp(state.released+amount*.32,0,1);state.feedPulse=1;
  for(let i=0;i<4;i++)state.feedBeads.push({q:Math.random(),speed:.55+Math.random()*.55,size:.8+Math.random()*1.5});
  if(state.feedBeads.length>90)state.feedBeads.splice(0,state.feedBeads.length-90);
  window.dispatchEvent(new CustomEvent('nutrient',{detail:{source,amount}}));return true;
}
function releaseSeed(){
  state.pointer.down=false;state.phase='release';state.releaseUntil=state.time+2.2;state.released=clamp(state.released+.12,0,1);state.releasePulse=1;state.cycle++;
  for(let i=0;i<26;i++)state.bursts.push({a:i/26*TAU+(Math.random()-.5)*.12,q:Math.random()*.18,s:.35+Math.random()*.8,life:1});
  state.memories.push({x:state.pointer.x,y:state.pointer.y,t:state.time,cycle:state.cycle});if(state.memories.length>8)state.memories.shift();
  window.dispatchEvent(new CustomEvent('seed-release'));
}
function tapNutrient(source='tap'){
  if(!canInteract()||state.coreFocus<.16)return false;
  state.phase='nurture';
  const accepted=emitNutrient(.16,source);
  if(!accepted)return false;
  setTimeout(()=>{if(canInteract()){releaseSeed();}},220);
  return true;
}
function point(e){const r=canvas.getBoundingClientRect();state.pointer.x=clamp((e.clientX-r.left)/r.width,0,1);state.pointer.y=clamp((e.clientY-r.top)/r.height,0,1);state.pointer.active=true;state.coreFocus=clamp(1-coreDistance()/.24,0,1);state.observer=clamp(state.observer+.008,0,1);if(state.time-state.lastTrailAt>.035){state.trail.push({x:state.pointer.x,y:state.pointer.y,t:state.time});state.lastTrailAt=state.time;if(state.trail.length>64)state.trail.shift();}if(state.pointer.down&&state.coreFocus<.12)releaseSeed();}
canvas.addEventListener('pointermove',e=>{if(canInteract())point(e)});
canvas.addEventListener('pointerdown',e=>{if(!canInteract())return;canvas.setPointerCapture?.(e.pointerId);state.suppressClick=true;point(e);if(state.coreFocus>.16)tapNutrient('touch');else{state.phase='seeking';state.feedPulse=.25;}});
canvas.addEventListener('pointerup',()=>{state.pointer.down=false;});
canvas.addEventListener('pointercancel',()=>{state.pointer.down=false;});
canvas.addEventListener('pointerleave',()=>{state.pointer.active=false;state.pointer.down=false;});
canvas.addEventListener('click',()=>{if(!canInteract())return;if(state.suppressClick){state.suppressClick=false;return;}tapNutrient('tap');});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&canInteract()&&!e.target.closest('button,a,input,textarea,select')){e.preventDefault();state.coreFocus=1;tapNutrient('space');}});
function resetSeed(){state.pointer.down=false;state.pointer.active=false;state.targetEnergy=.08;state.energy=.08;state.released=0;state.releasePulse=0;state.releaseUntil=0;state.feedPulse=0;state.coreFocus=0;state.observer=0;state.phase='seeking';state.cycle=0;state.suppressClick=false;state.trail=[];state.feedBeads=[];state.bursts=[];state.memories=[];state.seedTarget=1;$('question').classList.remove('visible');state.particles.forEach((p,i)=>{p.a=hash(i*2.1)*TAU;p.r=.1+hash(i*9.4)*.98});}
const reset=$('reset');
if(reset)reset.addEventListener('click',()=>{resetSeed();window.dispatchEvent(new CustomEvent('seed-game-restart'));});
window.addEventListener('seed-game-enter',event=>{resetSeed();$('question').textContent=event.detail.card.question;});
window.addEventListener('seed-game-leave',()=>{state.pointer.down=false;state.pointer.active=false;state.coreFocus=0;});
window.addEventListener('seed-game-complete',()=>{state.pointer.down=false;state.releasePulse=1;state.released=.85;state.targetEnergy=Math.max(.72,state.targetEnergy);$('question').classList.add('visible');});
function rgb(kind,alpha){return kind==='ember'?`rgba(255,126,104,${alpha})`:`rgba(167,220,255,${alpha})`}
function drawFractalGrowth(cx,cy,base,energy,t){
  const growth=clamp((energy-.18)/.82,0,1); if(growth<=0) return;
  // Keep the emergent organism inside the projection frame while allowing
  // enough depth for a recognisable branching, coral-like silhouette.
  const depth=Math.floor(2+growth*4), sway=.018+growth*.045;
  ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.lineCap='round';
  function branch(x,y,len,angle,d,seed){
    const bend=Math.sin(t*.55+seed*5.3)*sway;
    const nx=x+Math.cos(angle+bend)*len, ny=y+Math.sin(angle+bend)*len;
    const grad=ctx.createLinearGradient(x,y,nx,ny);
    grad.addColorStop(0,`rgba(90,211,255,${.3+growth*.42})`);
    grad.addColorStop(1,`rgba(255,105,197,${.28+growth*.55})`);
    ctx.strokeStyle=grad; ctx.lineWidth=Math.max(.7,base*(.014+(depth-d)*.004));
    ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo((x+nx)/2+Math.sin(seed*8+t)*len*.08,(y+ny)/2+Math.cos(seed*7+t)*len*.08,nx,ny);ctx.stroke();
    const dots=Math.max(2,Math.floor(len/12));
    for(let i=1;i<dots;i++){const q=i/dots,px=lerp(x,nx,q),py=lerp(y,ny,q);const rr=.7+hash(seed*91+i)*1.9;ctx.fillStyle=i%3===0?`rgba(255,137,210,${.42+growth*.42})`:`rgba(109,220,255,${.34+growth*.4})`;ctx.beginPath();ctx.arc(px,py,rr,0,TAU);ctx.fill();}
    if(d<=0){ctx.fillStyle=`rgba(255,168,225,${.4+growth*.5})`;ctx.beginPath();ctx.arc(nx,ny,1.2+growth*2.2,0,TAU);ctx.fill();return;}
    const spread=.22+growth*.2+hash(seed*3.7)*.12;
    branch(nx,ny,len*(.66+hash(seed*4.1)*.1),angle-spread,d-1,seed*2.07+1.1);
    branch(nx,ny,len*(.63+hash(seed*5.2)*.12),angle+spread,d-1,seed*2.31+2.4);
    if(d<depth-2 && growth>.62) branch(nx,ny,len*.43,angle+(hash(seed*6.4)-.5)*.3,d-2,seed*3.17+4.8);
  }
  const trunk=base*(.48+growth*1.28), originY=cy+base*.82;
  branch(cx,originY,trunk,-Math.PI/2,depth,1.7);
  if(growth>.48){branch(cx-base*.18,originY+base*.1,base*(.55+growth*.55),-Math.PI*.72,Math.max(1,depth-2),9.2);branch(cx+base*.18,originY+base*.08,base*(.58+growth*.5),-Math.PI*.28,Math.max(1,depth-2),13.7);}
  ctx.restore();
}
// A procedural organic model assembled from the visual grammar of the plant
// archive: membrane, fissure, radial growth, tendrils, segmentation and
// clustered nutrients. It stays in canvas so the installation can run locally
// without a model/API dependency.
function drawComplexModel(cx,cy,base,energy,t){
  const g=clamp((energy-.08)/.92,0,1), pulse=1+Math.sin(t*1.1)*.018;
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(-.12+Math.sin(t*.18)*.025);
  ctx.globalCompositeOperation='lighter';
  // Deep inner chamber: a seed, a meteorite and a small universe at once.
  const chamber=ctx.createRadialGradient(0,0,base*.05,0,0,base*.7);
  chamber.addColorStop(0,`rgba(255,220,188,${.18+g*.22})`);
  chamber.addColorStop(.18,`rgba(255,84,86,${.16+g*.32})`);
  chamber.addColorStop(.55,'rgba(29,92,130,.12)');
  chamber.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=chamber; ctx.beginPath(); ctx.ellipse(0,0,base*.74,base*1.05,0,0,TAU); ctx.fill();
  // Twelve unequal membrane ribs; the asymmetry prevents a generic icon.
  ctx.lineCap='round';
  for(let i=0;i<12;i++){
    const a=i/12*TAU+Math.sin(t*.14+i)*.025, wob=.74+hash(i*8.7)*.24;
    const r0=base*.12, r1=base*(.63+wob*.18*g), spread=.16+hash(i*4.2)*.13;
    const x0=Math.cos(a)*r0,y0=Math.sin(a)*r0*.82;
    const x1=Math.cos(a)*r1,y1=Math.sin(a)*r1*.82;
    ctx.beginPath(); ctx.moveTo(x0,y0);
    ctx.quadraticCurveTo(Math.cos(a+spread)*r1*.7,Math.sin(a+spread)*r1*.58,x1,y1);
    ctx.strokeStyle=i%3===0?`rgba(255,130,119,${.22+g*.44})`:`rgba(125,209,244,${.16+g*.35})`;
    ctx.lineWidth=.55+g*1.1; ctx.stroke();
  }
  // Radial petals / solar plates emerge after the core receives enough food.
  if(g>.16){
    const petals=8+Math.floor(g*8);
    for(let i=0;i<petals;i++){
      const a=i/petals*TAU-t*.07, len=base*(.42+g*.65)*(0.82+hash(i*2.8)*.24), w=base*(.045+g*.06);
      const bx=Math.cos(a)*base*.18, by=Math.sin(a)*base*.18*.78;
      const tx=Math.cos(a)*len, ty=Math.sin(a)*len*.78;
      ctx.beginPath(); ctx.moveTo(bx,by);
      ctx.bezierCurveTo(Math.cos(a+.28)*len*.52,Math.sin(a+.28)*len*.42,Math.cos(a-.18)*len*.84,Math.sin(a-.18)*len*.66,tx,ty);
      ctx.bezierCurveTo(Math.cos(a+.15)*len*.84,Math.sin(a+.15)*len*.66,Math.cos(a-.25)*len*.48,Math.sin(a-.25)*len*.42,bx,by);
      const pg=ctx.createLinearGradient(bx,by,tx,ty); pg.addColorStop(0,`rgba(255,103,160,${.08+g*.18})`); pg.addColorStop(.52,`rgba(113,204,255,${.12+g*.27})`); pg.addColorStop(1,`rgba(190,128,255,${.05+g*.22})`);
      ctx.fillStyle=pg; ctx.fill();
    }
  }
  // Segmented ring: cactus ribs / flower whorl / orbital apparatus.
  if(g>.3){
    ctx.save(); ctx.scale(1,.62);
    for(let ring=0;ring<3;ring++){
      const rr=base*(.58+ring*.115+g*.12), n=14+ring*4;
      for(let i=0;i<n;i++){
        const a=i/n*TAU+t*(.08+ring*.02), gap=.012+hash(i*3.1+ring)*.018;
        ctx.beginPath();ctx.arc(0,0,rr,a+gap,a+TAU/n-gap);
        ctx.strokeStyle=ring===1?`rgba(255,153,188,${.18+g*.22})`:`rgba(135,217,255,${.11+g*.18})`;
        ctx.lineWidth=1.1+g*.7;ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Tendrils search for contact, then loop back like a memory trace.
  if(g>.42){
    for(let k=0;k<5;k++){
      const a=k/5*TAU+t*.06, turns=1.2+g*.8, maxR=base*(.72+g*.82), pts=34;
      ctx.beginPath();
      for(let j=0;j<=pts;j++){
        const q=j/pts, ang=a+q*turns*TAU, rr=base*.18+q*maxR;
        const x=Math.cos(ang)*rr, y=Math.sin(ang)*rr*.72;
        j?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.strokeStyle=k%2?`rgba(112,217,255,${.2+g*.28})`:`rgba(255,123,188,${.2+g*.3})`;
      ctx.lineWidth=.45+g*.75;ctx.stroke();
    }
  }
  // Nutrient nodes remain discrete, like the red points in the botanical plates.
  const nodes=6+Math.floor(g*14);
  for(let i=0;i<nodes;i++){
    const a=hash(i*9.1)*TAU+t*(.12+hash(i)*.08), rr=base*(.18+hash(i*2.7)*(.7+g*.8));
    const x=Math.cos(a)*rr,y=Math.sin(a)*rr*.76, r=1+hash(i*4.3)*(1.2+g*2.2);
    ctx.fillStyle=i%4===0?`rgba(255,99,86,${.45+g*.45})`:`rgba(255,190,125,${.2+g*.34})`;
    ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
  }
  ctx.restore();
}
function draw(now){const t=now*.001;state.time=t;const dt=.016;
  state.targetEnergy*=state.pointer.down?.9997:.9975;state.energy+=((state.targetEnergy-state.energy)*.055);state.released*=.994;state.releasePulse*=.94;state.feedPulse*=.9;state.seedScale+=(state.seedTarget-state.seedScale)*.04;
  if(!state.pointer.down&&t>state.releaseUntil&&state.phase==='release')state.phase='seeking';
  const phase=state.pointer.down?(state.coreFocus>.45?'孕育 / NURTURE':'接触 / CONTACT'):(state.phase==='release'||state.releasePulse>.15||state.energy>.72)?'释放 / RELEASE':state.coreFocus>.12?'已定位 / FOUND':'寻找 / SEEKING';
  $('phase-label').textContent=phase;$('energy-label').textContent=`养分 ${String(Math.round(state.energy*100)).padStart(2,'0')}%`;$('meter-fill').style.width=`${state.energy*100}%`;
  $('hint').textContent=(state.phase==='release'||state.releasePulse>.15)?'回应正在返回：先听一会儿':state.coreFocus>.12?'找到核心，点击一次，然后停下来听':'移动光标，寻找种子内部的红色核心';
  if(window.__seedNodeHint)$('hint').textContent=window.__seedNodeHint;
  if(state.energy>.7) $('question').classList.add('visible');if(film){film.style.opacity=`${.1+state.energy*.2}`;film.playbackRate=.78+state.energy*.42;}
  ctx.clearRect(0,0,state.w,state.h);ctx.fillStyle='#f5f0e9';ctx.fillRect(0,0,state.w,state.h);const cx=state.w*.53+(state.pointer.x-.5)*-18,cy=state.h*.53+(state.pointer.y-.5)*-12;const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.max(state.w,state.h)*.72);bg.addColorStop(0,'rgba(255,255,255,.6)');bg.addColorStop(.48,'rgba(249,245,239,.28)');bg.addColorStop(1,'rgba(228,220,215,.16)');ctx.fillStyle=bg;ctx.fillRect(0,0,state.w,state.h);
  // A quiet isometric drafting grid grounds the floating cabinet in a real space.
  ctx.save();ctx.strokeStyle='rgba(126,111,132,.12)';ctx.lineWidth=.55;const horizon=state.h*.72,step=Math.max(22,Math.min(42,state.w*.03));
  for(let i=-22;i<=22;i++){const x=state.w*.52+i*step;ctx.beginPath();ctx.moveTo(state.w*.52+(x-state.w*.52)*.12,horizon);ctx.lineTo(x,state.h);ctx.stroke();}
  for(let j=0;j<12;j++){const y=horizon+Math.pow(j/11,1.55)*(state.h-horizon);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(state.w,y);ctx.stroke();}
  ctx.restore();
  for(const s of state.stars){const tw=.68+.32*Math.sin(t*1.4+s.x*9);const alpha=s.a*tw*.18;ctx.fillStyle=s.c==='ember'?`rgba(231,138,145,${alpha})`:`rgba(102,154,168,${alpha})`;ctx.beginPath();ctx.arc(s.x*state.w,s.y*state.h,s.r,0,TAU);ctx.fill();}
  // The orbital ecology: it bends toward the observer and is perturbed by release.
  ctx.save();ctx.translate(cx,cy);ctx.rotate(-.18);ctx.scale(1,.55);for(let b=0;b<18;b++){const rr=Math.min(state.w,state.h)*(.28+b*.014);ctx.beginPath();ctx.arc(0,0,rr,-.35,TAU-.03);ctx.strokeStyle=`rgba(129,196,255,${.06+(b%6===0?.13:0)+state.released*.1})`;ctx.lineWidth=b%6===0?1.25:.65;ctx.stroke();}ctx.restore();
  const base=Math.min(state.w,state.h)*.15*state.seedScale;const sx=cx,sy=cy;
  // A small probe makes the causal path legible: search for the red core first.
  if(state.pointer.active){const px=state.pointer.x*state.w,py=state.pointer.y*state.h;const rr=7+state.coreFocus*13;ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=state.coreFocus>.12?'rgba(255,126,104,.9)':'rgba(167,220,255,.58)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(px,py,rr,0,TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(px-rr-5,py);ctx.lineTo(px+rr+5,py);ctx.moveTo(px,py-rr-5);ctx.lineTo(px,py+rr+5);ctx.stroke();if(state.coreFocus>.12){ctx.strokeStyle=`rgba(255,126,104,${.18+state.coreFocus*.24})`;ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(sx,sy);ctx.stroke();ctx.setLineDash([]);}ctx.restore();}
  // During nurture, a visible stream travels from the observer to the red core.
  if(state.pointer.down&&state.coreFocus>.12){const px=state.pointer.x*state.w,py=state.pointer.y*state.h;ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=`rgba(255,126,104,${.22+state.coreFocus*.25})`;ctx.lineWidth=1.4+state.feedPulse*1.4;ctx.setLineDash([3,7]);ctx.lineDashOffset=-t*35;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(sx,sy);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
  // Each release leaves a short-lived memory orbit, so the action has a past.
  if(state.memories.length){ctx.save();ctx.globalCompositeOperation='lighter';for(const m of state.memories){const age=clamp((t-m.t)/8,0,1),mx=m.x*state.w,my=m.y*state.h;ctx.strokeStyle=`rgba(255,126,104,${.16*(1-age)})`;ctx.lineWidth=.7;ctx.beginPath();ctx.arc(mx,my,10+age*42,0,TAU);ctx.stroke();}ctx.restore();}
  // Release particles travel outward from the seed before fading into the ring.
  // Red nutrients orbit the seed and change direction when the seed releases.
  for(const p of state.particles){p.a+=dt*(p.s*(.35+state.energy*.7))*(state.released>.25?-1:1);const rr=base*(.35+p.r*1.9)+(state.released*state.released)*base*2.4*p.p;let x=sx+Math.cos(p.a+t*.09)*rr,y=sy+Math.sin(p.a+t*.09)*rr*.72;if(state.pointer.down){const dx=sx-x,dy=sy-y;const pull=.012*state.energy;x+=dx*pull;y+=dy*pull}const a=(p.kind==='ember'?.35+.6*state.energy:.08+.22*state.energy)*(p.p>.95?1.4:1);ctx.fillStyle=rgb(p.kind,a);ctx.fillRect(x,y,p.size,p.size);}
  // Each tap sends a discrete bead toward the core, making the pause between
  // inputs visible instead of requiring a sustained hold.
  for(let i=state.feedBeads.length-1;i>=0;i--){const bead=state.feedBeads[i];bead.q+=dt*bead.speed;if(bead.q>1){state.feedBeads.splice(i,1);continue;}const px=state.pointer.x*state.w,py=state.pointer.y*state.h;const x=lerp(px,sx,bead.q),y=lerp(py,sy,bead.q);ctx.fillStyle=`rgba(255,183,128,${(1-bead.q)*(.45+state.feedPulse*.35)})`;ctx.fillRect(x,y,bead.size,bead.size);}
  // Release is an observable event, not only a label: a pulse leaves the core.
  if(state.releasePulse>.01){ctx.save();ctx.globalCompositeOperation='lighter';for(let i=0;i<3;i++){const q=1-state.releasePulse+i*.22;ctx.strokeStyle=`rgba(255,126,104,${state.releasePulse*(.28-i*.06)})`;ctx.lineWidth=1.2-i*.2;ctx.beginPath();ctx.arc(sx,sy,base*(.8+q*2.8),0,TAU);ctx.stroke();}ctx.restore();}
  if(state.bursts.length){ctx.save();ctx.globalCompositeOperation='lighter';for(let i=state.bursts.length-1;i>=0;i--){const b=state.bursts[i];b.q+=dt*b.s;b.life-=dt*.9;if(b.life<=0){state.bursts.splice(i,1);continue;}const r0=base*(.45+b.q*2.7),r1=r0+base*.2;ctx.strokeStyle=`rgba(231,138,145,${b.life*.55})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(sx+Math.cos(b.a)*r0,sy+Math.sin(b.a)*r0*.72);ctx.lineTo(sx+Math.cos(b.a)*r1,sy+Math.sin(b.a)*r1*.72);ctx.stroke();}ctx.restore();}
  // Outer shell
  ctx.save();ctx.translate(sx,sy);ctx.rotate(-.16+(state.pointer.x-.5)*.16);const shellW=base*1.02,shellH=base*1.65;const glow=ctx.createRadialGradient(0,0,base*.15,0,0,base*1.55);glow.addColorStop(0,`rgba(255,110,92,${.08+state.energy*.16})`);glow.addColorStop(.48,'rgba(136,205,235,.06)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.ellipse(0,0,shellW*1.2,shellH*.82,0,0,TAU);ctx.fill();
  const shell=ctx.createLinearGradient(-shellW,-shellH,shellW,shellH);shell.addColorStop(0,'rgba(203,232,235,.32)');shell.addColorStop(.38,'rgba(152,181,202,.24)');shell.addColorStop(.68,'rgba(128,105,156,.18)');shell.addColorStop(1,'rgba(82,73,104,.16)');ctx.fillStyle=shell;ctx.beginPath();ctx.moveTo(0,-shellH);ctx.bezierCurveTo(shellW*.9,-shellH*.42,shellW*.78,shellH*.6,0,shellH);ctx.bezierCurveTo(-shellW*.76,shellH*.6,-shellW*.9,-shellH*.42,0,-shellH);ctx.fill();ctx.strokeStyle=`rgba(104,157,175,${.62+state.energy*.18})`;ctx.lineWidth=1.4;ctx.stroke();
  // Internal membrane and ribs: natural-history morphology, not a literal plant.
  ctx.globalAlpha=.26+.35*state.energy;for(let i=0;i<9;i++){const side=i%2?1:-1,q=(i+1)/10;ctx.beginPath();ctx.moveTo(0,shellH*.55);ctx.bezierCurveTo(side*shellW*q,-shellH*.1,side*shellW*(.4+q*.5),shellH*.12,side*shellW*.4,-shellH*.72);ctx.strokeStyle=i%3===0?'rgba(255,136,111,.72)':'rgba(167,220,255,.65)';ctx.lineWidth=.55+state.energy*.45;ctx.stroke();}ctx.globalAlpha=1;
  // The red core grows, then opens the shell without becoming a flower.
  const coreR=base*(.08+state.energy*.16);const core=ctx.createRadialGradient(0,0,0,0,0,coreR*3);core.addColorStop(0,'rgba(255,234,207,.98)');core.addColorStop(.2,'rgba(255,112,91,.98)');core.addColorStop(.65,'rgba(255,70,61,.25)');core.addColorStop(1,'rgba(255,70,61,0)');ctx.fillStyle=core;ctx.beginPath();ctx.arc(0,0,coreR*3,0,TAU);ctx.fill();ctx.fillStyle='#ff765f';ctx.beginPath();ctx.arc(0,0,coreR,0,TAU);ctx.fill();
  if(state.energy>.55){ctx.strokeStyle=`rgba(255,134,108,${(state.energy-.5)*.8})`;ctx.lineWidth=1;ctx.setLineDash([2,5]);for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(0,0,base*(.74+i*.08),-.8+i*.2,1.4+i*.25);ctx.stroke();}ctx.setLineDash([])}ctx.restore();
  // The seed becomes a branching life-form as accumulated nutrients cross the threshold.
  drawComplexModel(sx,sy,base,state.energy,t);
  drawFractalGrowth(sx,sy,base,state.energy,t);
  // Observer traces remain as evidence rather than a decorative cursor.
  if(state.trail.length>1){ctx.beginPath();state.trail.forEach((p,i)=>{const x=p.x*state.w,y=p.y*state.h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle='rgba(255,126,104,.14)';ctx.lineWidth=1;ctx.stroke();}
  $('loading').classList.add('done');requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
