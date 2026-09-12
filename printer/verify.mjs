import assert from 'node:assert/strict';
import {timeline} from './timeline.js';
import {CARDS} from '../game-cards.js';
const cases=[
 [25,{readyAt:1},true], [24.9,{readyAt:1},false],
 [40,{readyAt:null},false], [60,{failed:true},false],
 [21,{readyAt:1,mode:'live'},true], [46,{readyAt:40,mode:'live'},false], [47,{readyAt:40,mode:'live'},true]
];
for(const [t,opts,done] of cases){const state=timeline(t,opts);assert.equal(state.complete,done);assert.ok(Number.isFinite(state.explosion));}
assert.equal(timeline(35,{readyAt:null}).overdue,true);
const root=`http://127.0.0.1:${process.env.PORT||8765}`;
const post=(path,body,headers={})=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const request_id='integration-verification-garden-v1.1',input={m:3,n:5,a:.27576837112805397,b:-.9612241182395393,seed:333341133,request_id};
const create=()=>post('/api/jobs',input).then(r=>r.json());
const first=await create(),again=await create();assert.equal(first.id,again.id,'Idempotent creation must not allocate another edition');
let job;
for(let i=0;i<30;i++){job=await fetch(root+'/api/jobs/'+first.id).then(r=>r.json());if(job.status!=='generating')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(job.status,'ready');assert.equal(job.style_version,'garden-v1.1');assert.equal(job.style_scale.abstraction,.96);for(const k of ['m','n','a','b','seed'])assert.equal(job.params[k],input[k]);
for(const path of [job.image,job.pdf,job.particles]){const r=await fetch(root+path);assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>100);}
const invalid=await post('/api/jobs',{...input,m:3,n:3,request_id:'invalid'});assert.equal(invalid.status,400);
const print=await post('/api/jobs/'+job.id+'/print',{printer:'__nonexistent_test_queue__'});assert.equal(print.status,400);
const after=await fetch(root+'/api/jobs/'+job.id).then(r=>r.json());assert.equal(after.print_status,'not_submitted');
const rejected=await post('/api/jobs',input,{Origin:'https://untrusted.example'});assert.equal(rejected.status,403);

// Card input: one card fixes m and the seed draws a different n; two cards are the usual pair.
const one=await post('/api/jobs',{cards:[9],seed:424242,request_id:'verify-one-card'}).then(r=>r.json());
assert.equal(one.params.m,9);assert.notEqual(one.params.n,9);assert.ok(one.params.n>=1&&one.params.n<=12);
assert.equal(one.params.n_source,'random');assert.deepEqual(one.params.cards,[9]);
const replay=await post('/api/jobs',{cards:[9],seed:424242,request_id:'verify-one-card-replay'}).then(r=>r.json());
for(const k of ['n','a','b'])assert.equal(replay.params[k],one.params[k],'the same seed must reproduce n and the mixing');
const two=await post('/api/jobs',{cards:[11,4],seed:7,request_id:'verify-two-cards'}).then(r=>r.json());
assert.equal(two.params.m,4);assert.equal(two.params.n,11);assert.equal(two.params.n_source,'card');
for(const j of [one,two])for(const card of j.story.cards)assert.equal(card.name,CARDS[card.index-1].name,'story card names must match game-cards.js');
for(const bad of [[],[0],[13],[5,5],[1,2,3],'3'])assert.equal((await post('/api/jobs',{cards:bad,request_id:'bad-'+JSON.stringify(bad)})).status,400,JSON.stringify(bad));
let oneJob;
for(let i=0;i<60;i++){oneJob=await fetch(root+'/api/jobs/'+one.id).then(r=>r.json());if(oneJob.status!=='generating')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(oneJob.status,'ready');assert.equal((await fetch(root+oneJob.image)).status,200);

// Direct printing sends an A4 JPEG page rendered with every new artwork.
const fresh=await post('/api/jobs',{cards:[1],seed:99,request_id:'verify-print-page-'+Date.now()}).then(r=>r.json());
let freshJob;
for(let i=0;i<60;i++){freshJob=await fetch(root+'/api/jobs/'+fresh.id).then(r=>r.json());if(freshJob.status!=='generating')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(freshJob.status,'ready');assert.ok(freshJob.print_image,'ready jobs carry a print page');
const printPage=await fetch(root+freshJob.print_image);assert.equal(printPage.status,200);assert.match(printPage.headers.get('content-type')||'',/jpeg/);
const pageBytes=(await printPage.arrayBuffer()).byteLength;assert.ok(pageBytes>50_000&&pageBytes<3_000_000,`print page ${pageBytes} bytes`);

// Dice relay from hardware/dice_push.py.
assert.equal((await post('/api/dice',{values:[7]})).status,400);
const dice=await post('/api/dice',{values:[2,5]}).then(r=>r.json());assert.deepEqual(dice.values,[2,5]);assert.equal(dice.live,true);
assert.deepEqual((await fetch(root+'/api/dice').then(r=>r.json())).values,[2,5]);

// The site root is a git checkout: code, database and dotfiles stay private; the pages stay public.
for(const path of ['/.git/config','/.gitignore','/printer/server.py','/printer/jobs/archive.sqlite3'])assert.equal((await fetch(root+path)).status,403,path);
for(const path of ['/','/prototype-3d.html','/bridge.js','/game-cards.js','/printer/','/printer/assets/printer.glb'])assert.equal((await fetch(root+path)).status,200,path);

console.log(JSON.stringify({timeline_cases:8,idempotent_creation:true,exact_input_transfer:true,artifact_files:true,invalid_input_rejected:true,missing_printer_not_submitted:true,cross_origin_write_rejected:true,
  one_card:{m:one.params.m,n:one.params.n,job:one.id},two_cards:{m:two.params.m,n:two.params.n},card_names_match_game_cards:true,dice_relay:true,private_paths_blocked:true,job:job.id},null,2));
