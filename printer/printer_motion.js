// Presentation choreography; source artwork, story and probability remain external.
const REBOUND_TRAVEL=1.8;
const clamp=x=>Math.min(1,Math.max(0,x));
export const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10)};
const range=(a,b,t)=>ease((t-a)/(b-a));
export function depthCue(distance,radius=.95){
 const x=clamp((distance-(radius-.07))/.24),far=x*x*(3-2*x);
 return {far,blurPixels:5.5*far,saturation:1.18-.76*far,opacity:1-.67*far};
}
// A compact impulse with zero position/velocity at both ends. No perpetual shake.
export function spring(time,start,duration=.65){
 const q=(time-start)/duration;
 if(q<=0||q>=1)return 0;
 return Math.sin(q*Math.PI*4)*Math.exp(-3.6*q)*range(0,.12,q)*(1-range(.78,1,q));
}
export function modulePlan(name,base){
 const side=base.x<0?-1:1;
 let group,start,travel,from,rotation,axis;
 if(/Lower opal|gasket|Silicone|chassis pan|porcelain deck/.test(name)){
  group='base';start=-1;travel=.1;from=[0,0,0];rotation=[0,0,0];axis=[0,1,0];
 }else if(/Thermoformed|Polished hood|hood edge|Hood front|Hinge|hinge/.test(name)){
  group='hood';start=1.60;travel=.87;from=[0,.052,.015];rotation=[-.17,0,0];axis=[0,1,0];
 }else if(name.startsWith('Rear enclosure')){
  group='rear';start=.62;travel=.67;from=[0,.014,-.055];rotation=[.06,0,0];axis=[0,0,-1];
 }else if(base.y>.135||/cross member|Rear upright|spine|edge return/.test(name)){
  group='tower';start=.45;travel=.68;from=[side*.012,.055,-.035];rotation=[0,side*.06,side*.025];axis=[0,1,0];
 }else if(/Acrylic side cheek|Side cooling|shell standoff|Front lower upright/.test(name)||(/fixing|recess/.test(name)&&Math.abs(base.x)>.10)){
  group='side';start=.80+(side>0?.14:0);travel=.57;from=[side*.075,.013,.012];rotation=[0,side*.18,side*.035];axis=[side,0,0];
 }else if(/Controller|PCB|Capacitor|Motor|motor|IC |Harness/.test(name)){
  group='core';start=.04;travel=.56;from=[side*.012,.015,-.05];rotation=[0,side*.07,0];axis=[0,0,-1];
 }else{
  group='transport';start=.24;travel=.63;from=[side*.035,.018,-.045];rotation=[.07,side*.08,0];axis=[0,0,-1];
 }
 const hash=Array.from(name).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,17);
 // Lid constituents land together; hardware elsewhere follows a short spatial ripple.
 const ripple=group==='hood'?0:group==='base'?0:clamp((base.x+.15)/.3)*.045+(hash%97)/97*.025;
 start+=ripple;
 const contact=start+travel,settle=group==='hood'?.72:.42;
 return {group,start,contact,end:contact+settle,from,rotation,axis,settle};
}
export function modulePose(plan,time,reduced=false){
 const u=clamp((time-plan.start)/(plan.contact-plan.start)),arrival=ease(u);
 const strength=reduced?.08:1,bounce=reduced?0:spring(time,plan.contact,plan.settle);
 const offset=plan.from.map((v,i)=>v*(1-arrival)*strength+plan.axis[i]*bounce*REBOUND_TRAVEL*(plan.group==='hood'?.005:.0018));
 const rotation=plan.rotation.map(v=>v*(1-arrival)*strength);
 if(plan.group==='hood'){rotation[0]+=.032*bounce;rotation[2]+=.006*bounce;}
 const opacity=plan.group==='base'?1:range(0,.22,u);
 return {visible:opacity>.001,opacity,progress:arrival,offset,rotation,locked:time>=plan.end,bounce};
}
export function assemblyResponse(time,reduced=false){
 if(reduced)return {x:0,y:0,z:0,pitch:0,roll:0};
 // A few major contacts, not hundreds of overlapping per-screw impacts.
 const core=spring(time,.65,.48),drive=spring(time,.94,.48),left=spring(time,1.41,.48),right=spring(time,1.56,.48),lid=spring(time,2.47,.74);
 return {x:REBOUND_TRAVEL*.0016*(left-right),y:REBOUND_TRAVEL*(-.003*core-.004*drive-.007*lid),z:REBOUND_TRAVEL*.0014*drive,pitch:.009*drive+.014*lid,roll:.013*(left-right)+.004*lid};
}
export function gearTurn(time,contact){
 // A short test turn, then a softer second nudge. This angle is retained into printing.
 return .80*range(contact+.04,contact+.39,time)+.26*range(contact+.50,contact+.78,time);
}
export function cameraPose(time,{print=0,idle=false,reduced=false}={}){
 if(idle||reduced)return {yaw:0,pitch:0,radius:.85+.095*range(.58,1,print),targetY:.13-.077*print,fov:29};
 const yaw=-.29*range(.05,1.30,time)+.29*range(1.9,3.45,time)+.10*range(3.45,5,time)-.10*range(5,8,time);
 const pitch=.085*range(.10,1.3,time)-.05*range(2.1,3.5,time)-.035*range(6,9,time);
 const radius=.85-.028*range(.1,1.3,time)+.028*range(2.1,3.5,time)+.095*range(.58,1,print);
 return {yaw,pitch,radius,targetY:.13-.012*range(.15,1.2,time)+.012*range(2,3.5,time)-.077*print,fov:29};
}
