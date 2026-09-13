import assert from 'node:assert/strict';
import {modulePlan,modulePose,depthCue,cameraPose} from './printer_motion.js';
import {timeline} from './timeline.js';
const samples=[['Rear enclosure paper support backplate',{x:0,y:.183,z:-.068}],['Rear enclosure roll chamber wall',{x:0,y:.11,z:-.084}],['Lower opal',{x:0,y:.02,z:0}],['Acrylic side cheek',{x:.11,y:.08,z:0}],['Thermoformed hood',{x:0,y:.12,z:0}],['Rear upright',{x:.09,y:.18,z:0}],['Controller PCB',{x:0,y:.04,z:0}],['Platen roller',{x:0,y:.07,z:.06}]];
for(const [name,base] of samples){
 const plan=modulePlan(name,base);assert.ok(plan.end<7.9);
 const initial=modulePose(plan,0);assert.equal(initial.visible,true);assert.ok(initial.offset.every(x=>x===0),'Start must match the assembled idle pose');
 for(const reduced of [false,true]){
  const final=modulePose(plan,8,reduced);assert.ok(final.locked);assert.ok(final.offset.every(x=>Math.abs(x)<1e-10));assert.ok(final.rotation.every(x=>Math.abs(x)<1e-10));
  let previous=modulePose(plan,0,reduced);
  for(let t=.005;t<=8;t+=.005){const next=modulePose(plan,t,reduced);assert.ok(Math.hypot(...next.offset.map((v,i)=>v-previous.offset[i]))<.006,'No docking position jumps');assert.ok(Math.abs(next.opacity-previous.opacity)<.10,'No visible opacity pops');previous=next;}
 }
 // Both position and velocity agree across anticipation / approach / docking boundaries.
 for(const t of [.1,.68,.85,plan.start,plan.end,...[.25,.48,.76,.82,.89,.91,.93].map(u=>plan.start+u*(plan.end-plan.start))]){
  const h=1e-5,l=modulePose(plan,t-h),c=modulePose(plan,t),r=modulePose(plan,t+h);
  for(let d=0;d<3;d++)assert.ok(Math.abs((c.offset[d]-l.offset[d])/h-(r.offset[d]-c.offset[d])/h)<.02,'Velocity must remain continuous');
 }
}
const idle=cameraPose(0,{idle:true}),start=cameraPose(0);assert.deepEqual(start,idle);
let last=start;
for(let t=.01;t<26;t+=.01){const tl=timeline(t,{readyAt:2});const camera=cameraPose(t,{print:tl.print});assert.ok(Math.abs(camera.yaw-last.yaw)<.004);assert.ok(Math.abs(camera.radius-last.radius)<.004);assert.equal(camera.fov,29);assert.ok(Math.abs(camera.yaw)<.31);last=camera;}
for(const readyAt of [0,2,9,18,40])for(const mode of ['rehearsal','live']){
 let previous=0;
 for(let t=0;t<=readyAt+30;t+=.01){const tl=timeline(t,{readyAt,mode});assert.ok(tl.print>=previous-1e-10);assert.ok(tl.print-previous<.008,'Paper cannot jump');assert.ok(!tl.complete||tl.print===1);if(t<readyAt)assert.equal(tl.print,0);previous=tl.print;}
}
for(const t of [8,20,40,90]){const tl=timeline(t,{readyAt:null});assert.equal(tl.complete,false);assert.equal(tl.print,0);assert.equal(tl.phase,'assembled');}
assert.equal(timeline(10,{failed:true}).phase,'failed');
for(const radius of [.58,.85,1.35]){const near=depthCue(radius-.11,radius),far=depthCue(radius+.15,radius);assert.equal(near.blurPixels,0);assert.ok(far.blurPixels>5);assert.ok(near.saturation>far.saturation);}
console.log('PASS: idle continuity, staggered docking, continuous velocities/camera/feed, late-result gating and final hold.');
