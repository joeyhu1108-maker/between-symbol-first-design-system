import assert from 'node:assert/strict';
import {timeline} from './timeline.js';
const cases=[
 [25,{readyAt:1},true], [24.9,{readyAt:1},false],
 [40,{readyAt:null},false], [60,{failed:true},false],
 [21,{readyAt:1,mode:'live'},true], [46,{readyAt:40,mode:'live'},false], [47,{readyAt:40,mode:'live'},true]
];
for(const [t,opts,done] of cases){const state=timeline(t,opts);assert.equal(state.complete,done);assert.ok(Number.isFinite(state.explosion));}
assert.equal(timeline(35,{readyAt:null}).overdue,true);
const root='http://127.0.0.1:8765';
const request_id='integration-verification-garden-v1.1',input={m:3,n:5,a:.27576837112805397,b:-.9612241182395393,seed:333341133,request_id};
const create=()=>fetch(root+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json());
const first=await create(),again=await create();assert.equal(first.id,again.id,'Idempotent creation must not allocate another edition');
let job;
for(let i=0;i<30;i++){job=await fetch(root+'/api/jobs/'+first.id).then(r=>r.json());if(job.status!=='generating')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(job.status,'ready');assert.equal(job.style_version,'garden-v1.1');assert.equal(job.style_scale.abstraction,.96);for(const k of ['m','n','a','b','seed'])assert.equal(job.params[k],input[k]);
for(const path of [job.image,job.pdf,job.particles]){const r=await fetch(root+path);assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>100);}
const invalid=await fetch(root+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,m:3,n:3,request_id:'invalid'})});assert.equal(invalid.status,400);
const print=await fetch(root+'/api/jobs/'+job.id+'/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({printer:'__nonexistent_test_queue__'})});assert.equal(print.status,400);
const after=await fetch(root+'/api/jobs/'+job.id).then(r=>r.json());assert.equal(after.print_status,'not_submitted');
const rejected=await fetch(root+'/api/jobs',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(rejected.status,403);
console.log(JSON.stringify({timeline_cases:8,idempotent_creation:true,exact_input_transfer:true,artifact_files:true,invalid_input_rejected:true,missing_printer_not_submitted:true,cross_origin_write_rejected:true,job:job.id},null,2));
