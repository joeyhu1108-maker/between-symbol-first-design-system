// Rendering-only motion contract. Does not generate or change artworks, stories or probabilities.
const clamp=x=>Math.min(1,Math.max(0,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
export function depthCue(distance,radius=.95){
 const far=smooth((distance-(radius-.07))/.24);
 return {far,blurPixels:5.5*far,saturation:1.18-.76*far,opacity:1-.67*far};
}
export function modulePlan(name,base){
 const side=base.x<0?-1:1;
 if(/Lower opal|gasket|Silicone|chassis pan|porcelain deck/.test(name))return {group:'base',start:5.6,end:6.95,from:[0,-.20,.03],rotation:[0,0,0],axis:[0,-1,0]};
 if(/Thermoformed|Polished hood|hood edge|Hood front|Hinge|hinge/.test(name))return {group:'hood',start:10.25,end:11.85,from:[0,.105,.27],rotation:[-.8,0,0],axis:[0,0,1]};
 if(name.startsWith('Rear enclosure'))return {group:'rear',start:8.9,end:10.65,from:[0,.045,-.21],rotation:[.16,0,0],axis:[0,0,-1]};
 if(base.y>.135||/cross member|Rear upright|spine|edge return/.test(name))return {group:'tower',start:9.0,end:10.65,from:[side*.035,.17,-.14],rotation:[0,side*.16,side*.07],axis:[0,1,0]};
 if(/Acrylic side cheek|Side cooling|shell standoff|Front lower upright/.test(name)||(/fixing|recess/.test(name)&&Math.abs(base.x)>.10))return {group:'side',start:8.2+(side>0?.15:0),end:9.95+(side>0?.15:0),from:[side*.28,.035,.07],rotation:[0,side*.65,side*.17],axis:[side,0,0]};
 if(/Controller|PCB|Capacitor|Motor|motor|IC |Harness/.test(name))return {group:'core',start:6.8,end:8.25,from:[side*.025,.025,-.24],rotation:[0,side*.20,0],axis:[0,0,-1]};
 return {group:'transport',start:7.15,end:8.85,from:[side*.07,.05,-.19],rotation:[.18,side*.25,0],axis:[0,0,-1]};
}
export function modulePose(plan,time,reduced=false){
 const u=clamp((time-plan.start)/(plan.end-plan.start));
 let offset=[0,0,0];
 if(u<.72){const q=1-(1-u/.72)**3;offset=plan.from.map((v,i)=>v*(1-q)+plan.axis[i]*.009*q);}
 else if(u<.88){const q=1-smooth((u-.72)/.16);offset=plan.axis.map(v=>v*.009*q);}
 else {const q=(u-.88)/.12;offset=plan.axis.map(v=>v*.0018*Math.sin(q*Math.PI*2)*(1-q));}
 if(reduced)offset=offset.map(v=>v*.12);
 return {visible:time>=plan.start,progress:u,offset,rotation:plan.rotation.map(v=>v*(1-smooth(u/.84))*(reduced?.12:1)),locked:time>=plan.end};
}
