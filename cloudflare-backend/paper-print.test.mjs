import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../prototype-3d.js',import.meta.url),'utf8');
const paperStart=source.indexOf('function updatePaperPrint('),paperEnd=source.indexOf('function finishPrint(',paperStart);
const previewStart=source.indexOf('function startPrint('),previewEnd=source.indexOf('async function restartExperience(',previewStart);
assert.ok(paperStart>=0&&paperEnd>paperStart&&previewEnd>previewStart);
const implementation=source.slice(paperStart,paperEnd)+source.slice(previewStart,previewEnd);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness({nfc=true,paired=true,ready=true,send=async()=>({id:'original-run',received_at:'now'})}={}){
  const elements=new Map(),calls=[],events=[],timers=new Map(),job={id:'SG-20260913-0053-12345678'};
  let nextTimer=0,now=0;
  const state={stage:'printing',growth:6,paired,printStarted:false,printerFailed:false,
    generation:{status:ready?'ready':'generating',job},printerView:{start:()=>events.push('preview')}};
  function element(id){
    if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,textContent:'',classList:{remove(){}},setAttribute(k,v){this[k]=v;}});
    return elements.get(id);
  }
  const context=vm.createContext({state,nfcEnabled:nfc,$:element,CARDS:Array.from({length:12},(_,i)=>({id:String(i+1).padStart(2,'0')})),
    document:{body:{dataset:{}}},preparePrinterScene(){},preGenerateArtwork(){events.push('generate');},selectedSymbols(){return[];},setSymbolLoading(){},showPrintProgress(){},
    triggerNfcFallback(job,card){calls.push({job,card});return send(job,card);},syncPhone:(type,payload)=>events.push({type,...payload}),
    Date:{now:()=>now},setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(implementation+';this.api={printPaper,updatePaperPrint,startPrint};',context);
  return {...context.api,state,job,calls,events,element,timers,async flush(){for(let i=0;i<12;i++)await Promise.resolve();},async nextRetry(){const [id,timer]=timers.entries().next().value||[];if(!timer)return;timers.delete(id);now+=timer.delay;timer.callback();await this.flush();}};
}

test('confirmed station pairing automatically prints the same ready artwork once as the preview starts',async()=>{
  const pending=deferred(),h=harness({send:()=>pending.promise});
  h.startPrint();h.startPrint();await h.printPaper();
  assert.deepEqual(h.calls,[{job:h.job,card:'06'}]);
  assert.deepEqual(h.events,['preview']);
  assert.equal(h.element('paperPrint').disabled,true);
  assert.equal(h.element('paperPrint')['aria-busy'],'true');
  pending.resolve({id:'original-run'});await h.flush();
  assert.equal(h.state.generation.paperPrint,'confirmed');
  assert.equal(h.element('paperPrint').disabled,true);
  await h.printPaper();h.state.printStarted=false;h.startPrint();await h.flush();
  assert.equal(h.calls.length,1,'replaying or retrying the visual must not resubmit a confirmed paper print');
});

for(const [name,options] of [['ordinary public experience',{nfc:false}],['unconfirmed pairing',{paired:false}],['artwork not ready',{ready:false}]]){
  test(`${name} never dispatches physical printing`,async()=>{
    const h=harness(options);h.updatePaperPrint();h.startPrint();await h.printPaper();await h.flush();
    assert.equal(h.calls.length,0);
    if(options.nfc===false||options.ready===false)assert.equal(h.element('paperPrint').hidden,true);
  });
}

test('a failed submission exposes a retry without changing the bound job or card',async()=>{
  let attempts=0;const h=harness({send:async()=>{if(++attempts===1)throw Error('连接暂时中断');return {id:'original-run'};}});
  h.startPrint();await h.flush();
  assert.equal(h.element('paperPrintError').hidden,false);
  assert.equal(h.element('paperPrintError').textContent,'连接暂时中断');
  assert.equal(h.element('paperPrint').disabled,false);
  await h.printPaper();
  assert.deepEqual(h.calls,[{job:h.job,card:'06'},{job:h.job,card:'06'}]);
  assert.equal(h.element('paperPrintError').hidden,true);
  assert.equal(h.state.generation.paperPrint,'confirmed');
  assert.equal(h.element('paperPrint').disabled,true);
});

test('station printing recovers automatically after the NFC connection becomes ready',async()=>{
  let connected=false;const h=harness({send:async()=>{if(!connected)throw Error('NFC 联调正在恢复，请稍后核对本轮状态');return {id:'original-run'};}});
  h.startPrint();await h.flush();
  assert.equal(h.calls.length,1);
  assert.equal(h.element('artworkActions').hidden,false,'the symbolic retry remains available while the visual preview runs');
  assert.equal(h.timers.size,1);
  connected=true;await h.nextRetry();
  assert.equal(h.state.generation.paperPrint,'confirmed');
  assert.deepEqual(h.calls,[{job:h.job,card:'06'},{job:h.job,card:'06'}]);
  assert.equal(h.events.filter(value=>value==='preview').length,1);
  assert.equal(h.timers.size,0);
  h.startPrint();await h.nextRetry();assert.equal(h.calls.length,2);
});

for(const stoppedBy of ['restart','pagehide','replacement']){
  test(`an automatic retry cannot dispatch after ${stoppedBy}`,async()=>{
    const h=harness({send:async()=>{throw Error('连接暂时中断');}});
    h.startPrint();await h.flush();assert.equal(h.timers.size,1);
    if(stoppedBy==='restart')h.element('restart').disabled=true;
    else if(stoppedBy==='pagehide')h.state.generation.paperPrintStopped=true;
    else h.state.generation={status:'ready',job:{id:'another-job'}};
    await h.nextRetry();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  });
}

test('automatic retries are bounded and leave manual retry available',async()=>{
  const h=harness({send:async()=>{throw Error('NFC 连接待恢复');}});
  h.startPrint();await h.flush();
  for(let i=0;i<65&&h.timers.size;i++)await h.nextRetry();
  assert.equal(h.timers.size,0);assert.ok(h.calls.length>1&&h.calls.length<=61);
  assert.equal(h.element('paperPrint').disabled,false);
  const before=h.calls.length;await h.printPaper();assert.equal(h.calls.length,before+1);
});

for(const outcome of ['success','failure']){
  test(`late ${outcome} after the next-participant action cannot alter the screen`,async()=>{
    const pending=deferred(),h=harness({send:()=>pending.promise});
    const print=h.printPaper();h.element('restart').disabled=true;
    h.element('paperPrintError').textContent='next participant';
    h.element('paperPrint')['aria-label']='next participant';
    if(outcome==='success')pending.resolve({id:'old-run'});else pending.reject(Error('old failure'));
    await print;
    assert.equal(h.element('paperPrintError').textContent,'next participant');
    assert.equal(h.element('paperPrint')['aria-label'],'next participant');
    assert.equal(h.events.length,0,'late confirmation must not publish to the next phone');
  });
}

test('a replaced generation cannot receive a stale print response',async()=>{
  const pending=deferred(),h=harness({send:()=>pending.promise});
  const print=h.printPaper();h.state.generation={status:'idle',job:null};h.state.growth=4;
  pending.resolve({id:'old-run'});await print;
  assert.equal(h.state.generation.paperPrint,undefined);
  assert.equal(h.events.length,0);
});

test('the paper print control uses a dedicated SVG and no visible wording',async()=>{
  const html=await readFile(new URL('../prototype-3d.html',import.meta.url),'utf8');
  const symbols=await readFile(new URL('../symbol-interface.js',import.meta.url),'utf8');
  assert.match(html,/<button id="paperPrint"[^>]*aria-label="打印这件作品"[^>]*hidden><\/button>/);
  assert.match(symbols,/paperPrint:'print'/);
  assert.match(symbols,/print:'<path[^\n]*<circle/);
  assert.match(source,/\$\('paperPrint'\)\.onclick=printPaper/);
});
