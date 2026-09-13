import assert from 'node:assert/strict';
import {modulePlan,modulePose,depthCue} from './printer_motion.js';
const samples=[['Rear enclosure paper support backplate',{x:0,y:.183,z:-.068}],['Rear enclosure roll chamber wall',{x:0,y:.11,z:-.084}],['Lower opal',{x:0,y:.02,z:0}],['Acrylic side cheek',{x:.11,y:.08,z:0}],['Thermoformed hood',{x:0,y:.12,z:0}],['Rear upright',{x:.09,y:.18,z:0}],['Controller PCB',{x:0,y:.04,z:0}],['Platen roller',{x:0,y:.07,z:.06}]];
for(const [name,base] of samples){
 const plan=modulePlan(name,base);assert.ok(plan.end<=12);assert.equal(modulePose(plan,0).visible,false);
 for(const reduced of [false,true]){
  const pose=modulePose(plan,12,reduced);assert.ok(pose.locked);assert.ok(pose.offset.every(x=>Math.abs(x)<1e-10));assert.ok(pose.rotation.every(x=>Math.abs(x)<1e-10));
 }
 // Continuity across the approach, alignment and lock segments.
 for(const u of [.72,.88]){
  const t=plan.start+u*(plan.end-plan.start),a=modulePose(plan,t-1e-6),b=modulePose(plan,t+1e-6);
  assert.ok(Math.hypot(...a.offset.map((v,i)=>v-b.offset[i]))<1e-4);
 }
}
let last=depthCue(.7);
for(let d=.71;d<=1.3;d+=.01){const next=depthCue(d);assert.ok(next.blurPixels>=last.blurPixels-1e-10);assert.ok(next.saturation<=last.saturation+1e-10);last=next;}
console.log('Six assembly groups dock exactly; trajectories are continuous; farther surfaces are softer and less saturated.');

for(const radius of [.58,.85,1.35]){const near=depthCue(radius-.11,radius),far=depthCue(radius+.15,radius);assert.equal(near.blurPixels,0);assert.ok(far.blurPixels>5);assert.ok(near.saturation>far.saturation);}
