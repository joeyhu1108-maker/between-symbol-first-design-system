export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const smooth=(a,b,t)=>{const q=clamp((t-a)/(b-a));return q*q*(3-2*q)};
export function timeline(elapsed,{mode='rehearsal',readyAt=null,failed=false}={}){
 if(failed)return {phase:'failed',elapsed,form:0,bloom:0,landing:0,explosion:0,print:0,complete:false};
 const reveal=readyAt===null?Infinity:Math.max(mode==='rehearsal'?18:14,readyAt);
 const form=smooth(6,11,elapsed),finish=Number.isFinite(reveal)?smooth(reveal,reveal+3,elapsed):0;
 const bloom=.74*smooth(14,18,elapsed)+.26*finish;
 const landing=Number.isFinite(reveal)?smooth(reveal+2,reveal+4,elapsed):0;
 const print=Number.isFinite(reveal)?smooth(reveal+3,reveal+6,elapsed):0;
 const phase=elapsed<6?'cosmos':elapsed<11?'coalesce':elapsed<14?'printer':elapsed<reveal+3?'garden':elapsed<reveal+7?'print':'complete';
 return {phase,elapsed,reveal,form,bloom,landing,print,explosion:bloom*(1-landing),complete:elapsed>=reveal+7,overdue:elapsed>30&&readyAt===null};
}
