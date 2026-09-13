export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const smooth=(a,b,t)=>{let q=clamp((t-a)/(b-a));return q*q*(3-2*q)};
/** Completion is driven by a real result, never merely by elapsed time. */
export function timeline(elapsed,{mode='rehearsal',readyAt=null,failed=false}={}){
  if(failed)return {phase:'failed',elapsed,explosion:0,print:0,complete:false};
  const reveal=readyAt===null?Infinity:mode==='rehearsal'?Math.max(18,readyAt):Math.max(8,readyAt);
  const collapse=Number.isFinite(reveal)?smooth(reveal,reveal+3,elapsed):0;
  const explosion=smooth(3,8,elapsed)*(1-collapse);
  const print=Number.isFinite(reveal)?smooth(reveal+3,reveal+6,elapsed):0;
  let phase=elapsed<3?'receive':elapsed<8?'unfold':elapsed<reveal?'grow':elapsed<reveal+3?'gather':elapsed<reveal+7?'print':'complete';
  return {phase,elapsed,reveal,explosion,print,collapse,complete:elapsed>=reveal+7,overdue:elapsed>30&&readyAt===null};
}
