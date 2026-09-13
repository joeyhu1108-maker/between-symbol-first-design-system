import assert from 'node:assert/strict';
import {modulePlan,modulePose,depthCue,cameraPose,assemblyResponse,gearTurn} from './printer_motion.js';
import {timeline} from './timeline.js';
const samples=[['Rear enclosure paper support backplate',{x:0,y:.183,z:-.068}],['Rear enclosure roll chamber wall',{x:0,y:.11,z:-.084}],['Lower opal',{x:0,y:.02,z:0}],['Acrylic side cheek',{x:.11,y:.08,z:0}],['Thermoformed hood',{x:0,y:.12,z:0}],['Rear upright',{x:.09,y:.18,z:0}],['Controller PCB',{x:0,y:.04,z:0}],['Platen roller',{x:0,y:.07,z:.06}]];
for(const [name,base] of samples){
 const plan=modulePlan(name,base);assert.ok(plan.end<3.3);
 const initial=modulePose(plan,0);assert.equal(initial.visible,plan.group==='base','Only the stationary base is visible before the entrance');
 for(const reduced of [false,true]){
  const final=modulePose(plan,3.3,reduced);assert.ok(final.locked);assert.ok(final.offset.every(x=>Math.abs(x)<1e-10));assert.ok(final.rotation.every(x=>Math.abs(x)<1e-10));
  let previous=modulePose(plan,0,reduced);
  for(let t=.005;t<=3.3;t+=.005){const next=modulePose(plan,t,reduced);assert.ok(Math.hypot(...next.offset.map((v,i)=>v-previous.offset[i]))<.006,'No docking position jumps');assert.ok(Math.abs(next.opacity-previous.opacity)<.10,'No visible opacity pops');previous=next;}
 }
 // Both position and velocity agree across anticipation / approach / docking boundaries.
 for(const t of [plan.start,plan.contact,plan.end,plan.start+.22*(plan.contact-plan.start)]){
  const h=1e-5,l=modulePose(plan,t-h),c=modulePose(plan,t),r=modulePose(plan,t+h);
  for(let d=0;d<3;d++)assert.ok(Math.abs((c.offset[d]-l.offset[d])/h-(r.offset[d]-c.offset[d])/h)<.02,'Velocity must remain continuous');
 }
}
const idle=cameraPose(0,{idle:true}),start=cameraPose(0);assert.deepEqual(start,idle);
let last=start;
for(let t=.01;t<26;t+=.01){const tl=timeline(t,{readyAt:2});const camera=cameraPose(t,{print:tl.print});assert.ok(Math.abs(camera.yaw-last.yaw)<.006);assert.ok(Math.abs(camera.radius-last.radius)<.004);assert.equal(camera.fov,29);assert.ok(Math.abs(camera.yaw)<.31);last=camera;}
for(const readyAt of [0,2,9,18,40])for(const mode of ['rehearsal','live']){
 let previous=0;
 for(let t=0;t<=readyAt+30;t+=.01){const tl=timeline(t,{readyAt,mode});assert.ok(tl.print>=previous-1e-10);assert.ok(tl.print-previous<.008,'Paper cannot jump');assert.ok(!tl.complete||tl.print===1);if(t<readyAt)assert.equal(tl.print,0);previous=tl.print;}
}
for(const t of [8,20,40,90]){const tl=timeline(t,{readyAt:null});assert.equal(tl.complete,false);assert.equal(tl.print,0);assert.equal(tl.phase,'assembled');}
assert.equal(timeline(10,{failed:true}).phase,'failed');
for(const radius of [.58,.85,1.35]){const near=depthCue(radius-.11,radius),far=depthCue(radius+.15,radius);assert.equal(near.blurPixels,0);assert.ok(far.blurPixels>5);assert.ok(near.saturation>far.saturation);}

for(const [name,base] of samples){
 const plan=modulePlan(name,base);let distance=Infinity;
 for(let t=plan.start;t<=plan.contact;t+=.001){const pose=modulePose(plan,t);const next=Math.hypot(...pose.offset);assert.ok(next<=distance+1e-8,'Parts approach directly; no outward explosion');distance=next;}
}
for(const t of [0,3.3,10,25])assert.ok(Object.values(assemblyResponse(t)).every(x=>x===0));
let maximum=0;for(let t=0;t<3.3;t+=.005){const r=assemblyResponse(t);maximum=Math.max(maximum,Math.abs(r.y));assert.ok(Math.abs(r.y)<.013);assert.ok(Math.abs(r.roll)<.018);assert.ok(Object.values(assemblyResponse(t,true)).every(x=>x===0));}
assert.ok(maximum>.006,'Docking must transfer a visible small impulse to the whole body');
assert.equal(gearTurn(0,1),0);assert.ok(gearTurn(1.8,1)>1);assert.equal(gearTurn(10,1),gearTurn(25,1));
console.log('PASS: fast inward-only assembly, smooth docking, bounded body recoil, lid settlement, gear detail, camera and paper continuity.');

