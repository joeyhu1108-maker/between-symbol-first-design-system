// Presentation choreography; source artwork, story and probability remain external.
const clamp=x=>Math.min(1,Math.max(0,x));
export const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10)};
const range=(a,b,t)=>ease((t-a)/(b-a));
export function depthCue(distance,radius=.95){
 const x=clamp((distance-(radius-.07))/.24),far=x*x*(3-2*x);
 return {far,blurPixels:5.5*far,saturation:1.18-.76*far,opacity:1-.67*far};
}
export function modulePlan(name,base){
 const side=base.x<0?-1:1;
 let group,start,duration,from,rotation,axis;
 if(/Lower opal|gasket|Silicone|chassis pan|porcelain deck/.test(name)){
  group='base';start=.75;duration=1.6;from=[0,-.045,.015];rotation=[0,0,0];axis=[0,-1,0];
 }else if(/Thermoformed|Polished hood|hood edge|Hood front|Hinge|hinge/.test(name)){
  group='hood';start=5.65;duration=1.85;from=[0,.075,.10];rotation=[-.40,0,0];axis=[0,0,1];
 }else if(name.startsWith('Rear enclosure')){
  group='rear';start=4.65;duration=1.75;from=[0,.025,-.10];rotation=[.10,0,0];axis=[0,0,-1];
 }else if(base.y>.135||/cross member|Rear upright|spine|edge return/.test(name)){
  group='tower';start=4.45;duration=1.7;from=[side*.023,.08,-.07];rotation=[0,side*.10,side*.04];axis=[0,1,0];
 }else if(/Acrylic side cheek|Side cooling|shell standoff|Front lower upright/.test(name)||(/fixing|recess/.test(name)&&Math.abs(base.x)>.10)){
  group='side';start=3.5+(side>0?.32:0);duration=1.55;from=[side*.13,.022,.03];rotation=[0,side*.32,side*.07];axis=[side,0,0];
 }else if(/Controller|PCB|Capacitor|Motor|motor|IC |Harness/.test(name)){
  group='core';start=1.55;duration=1.55;from=[side*.018,.022,-.085];rotation=[0,side*.14,0];axis=[0,0,-1];
 }else{
  group='transport';start=2.35;duration=1.55;from=[side*.055,.025,-.08];rotation=[.12,side*.16,0];axis=[0,0,-1];
 }
 // Coordinate-based ripple keeps neighbours together but avoids whole-batch arrivals.
 const hash=Array.from(name).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,17);
 const ripple=clamp((base.x+.15)/.3)*.22+(hash%97)/97*.12;
 start+=ripple;
 return {group,start,end:start+duration,from,rotation,axis};
}
export function modulePose(plan,time,reduced=false){
 const u=clamp((time-plan.start)/(plan.end-plan.start));
 const departure=range(0,.85,time),arrival=range(0,.76,u);
 const approach=departure*(1-arrival),dock=range(.48,.76,u)*(1-range(.76,.91,u));
 const settle=range(.89,.93,u)*(1-range(.93,1,u));
 const strength=reduced?.08:1;
 const offset=plan.from.map((v,i)=>strength*(v*approach+plan.axis[i]*(.005*dock-.00065*settle)));
 const opacity=plan.group==='base'?1:Math.max(1-range(.10,.68,time),range(0,.25,u));
 return {visible:opacity>.001,opacity,progress:u,offset,rotation:plan.rotation.map(v=>v*departure*(1-range(0,.82,u))*strength),locked:time>=plan.end};
}
export function cameraPose(time,{print=0,idle=false,reduced=false}={}){
 if(idle||reduced)return {yaw:0,pitch:0,radius:.85+.095*range(.58,1,print),targetY:.13-.077*print,fov:29};
 // Broad, C2-continuous arcs. No FOV jumps, cuts, or sinusoidal camera shake.
 const out=range(0,2.4,time),across=range(2.4,7.8,time),returnFront=range(9,14.5,time);
 const yaw=-.29*out+.47*across-.18*returnFront;
 const pitch=.09*range(.3,3.6,time)-.055*range(4.4,8.2,time)-.035*range(14,20,time);
 const radius=.85+.075*range(0,1.6,time)-.095*range(1.6,5.2,time)+.02*range(5.6,8.5,time)+.095*range(.58,1,print);
 return {yaw,pitch,radius,targetY:.13-.016*range(1.2,4,time)+.016*range(5.4,8.4,time)-.077*print,fov:29};
}
