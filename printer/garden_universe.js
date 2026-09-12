import * as THREE from 'three';
/** A volumetric, mode-mixed nodal field inspired by Chladni patterns, not a physical plate solver. */
export function makeUniverse(count,p){
 let seed=p.seed>>>0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const positions=new Float32Array(count*3),colors=new Float32Array(count*3),uv=new Float32Array(count*2);
 const palette=[0x716a9d,0xaa788d,0xc47586,0xbb936c,0x8f9f78,0xaea7ba].map(x=>new THREE.Color(x));
 const k=(p.m+p.n)%5+1;
 for(let i=0;i<count;i++){
  let x=0,y=0,z=0;
  for(let j=0;j<60;j++){
   x=rnd()*2-1;y=rnd()*2-1;z=rnd()*2-1;if(x*x+y*y+z*z>1)continue;
   const f=p.a*Math.cos(Math.PI*p.m*x)*Math.cos(Math.PI*p.n*y)+p.b*Math.cos(Math.PI*p.n*y)*Math.cos(Math.PI*k*z)+.63*Math.cos(Math.PI*k*z)*Math.cos(Math.PI*p.m*x);
   if(Math.abs(f)<.19)break;
  }
  const r=1+.12*Math.sin(Math.atan2(z,x)*3+y*4);
  positions.set([x*.235*r,y*.205*r,z*.235*r],i*3);
  palette[Math.floor(rnd()*palette.length)].toArray(colors,i*3);uv.set([rnd(),rnd()],i*2);
 }
 return {positions,colors,uv};
}
export function themeAt(form){
 return {q:1,bg:[244,238,227],ink:[86,76,67],muted:[151,128,111],accent:[159,98,104]};
}
