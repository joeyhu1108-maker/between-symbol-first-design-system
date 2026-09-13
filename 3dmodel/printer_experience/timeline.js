export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const smooth=(a,b,t)=>{const q=clamp((t-a)/(b-a));return q*q*(3-2*q)};
export function timeline(elapsed,{mode='rehearsal',readyAt=null,failed=false}={}){
 if(failed)return {phase:'failed',elapsed,form:0,bloom:0,landing:0,explosion:0,print:0,creation:0,complete:false};
 const available=readyAt!==null&&Number.isFinite(readyAt);
 const creationStart=available?Math.max(4.2,readyAt+.35):Infinity;
 const finishAt=available?Math.max(mode==='rehearsal'?25:21,readyAt+7):Infinity;
 const printStart=creationStart+.9,printEnd=finishAt-1.2;
 const q=available?clamp((elapsed-printStart)/(printEnd-printStart)):0;
 // Gentle entry and exit, steady feed through the middle. Never an early strip + long stop.
 const feed=q*q*(3-2*q),creation=available?smooth(creationStart,printEnd,elapsed):0;
 const phase=elapsed<3.3?'assembly':elapsed<creationStart?'assembled':elapsed<printEnd?'creating':elapsed<finishAt?'print':'complete';
 return {phase,elapsed,creationStart,printStart,printEnd,finishAt,reveal:creationStart,form:smooth(0,3.3,elapsed),bloom:creation,landing:feed,print:feed,creation,explosion:0,complete:available&&elapsed>=finishAt,overdue:elapsed>30&&!available};
}
