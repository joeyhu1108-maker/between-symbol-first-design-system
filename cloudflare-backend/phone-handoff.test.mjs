import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const phoneSource=(await readFile(new URL('../phone.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const entrySource=(await readFile(new URL('../entry-display.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function mountScanEntry','function mountScanEntry');
const snapshot=(status='selected',extra={})=>({id:'round-one',status,selected_card:6,cards:[],ai_card:5,request_id:'entry-pPFcwzLxzG_MF6mTbVQAedNa',...extra});
const committed=extra=>snapshot('submitted',{cards:[6],handoff_ready:true,...extra});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function harness(){
  const nodes=new Map(),calls=[],animations=[],timers=new Map(),storage=new Map(),listeners=new Map();
  let timerId=0;
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    const attributes=new Map(),classes=new Set(),events=new Map();
    const element={id,dataset:{},hidden:true,disabled:false,textContent:'',innerHTML:'',children:[],
      classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);}},
      setAttribute(name,value){attributes.set(name,String(value));},getAttribute(name){return attributes.get(name)??null;},removeAttribute(name){attributes.delete(name);},
      addEventListener(name,listener){events.set(name,listener);},querySelector(selector){return node(`${id}:${selector}`);},querySelectorAll(){return [];},
      getAnimations(){return [];},animate(frames,options){const done=deferred();animations.push({id,frames,options,...done});return {finished:done.promise,cancel(){done.reject(Error('cancelled'));}};},
      append(...items){element.children.push(...items);},remove(){}};
    nodes.set(id,element);return element;
  }
  const sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const context=vm.createContext({console,URL,URLSearchParams,Uint8Array,AbortController,crypto:globalThis.crypto,
    sessionStorage,localStorage:sessionStorage,location:{search:'?session=round-one&card=6',href:'https://example.test/phone.html?session=round-one&card=6',replace(){}},history:{replaceState(){}},
    document:{getElementById:node,querySelectorAll:()=>[],addEventListener:(name,callback)=>listeners.set(name,callback),visibilityState:'visible'},
    window:{addEventListener:(name,callback)=>listeners.set(name,callback)},innerHeight:800,matchMedia:()=>({matches:false}),
    mountGlyph(){},mountSymbolLoading(){},actionGlyph(){},
    setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout(id){timers.delete(id);},
    fetch(url,options={}){const pending=deferred();calls.push({url,options,body:options.body?JSON.parse(options.body):undefined,...pending});return pending.promise;}
  });
  async function reply(call,data,status=200){call.resolve({ok:status>=200&&status<300,status,json:async()=>data});await flush();}
  const next=suffix=>{const call=calls.find(item=>!item.replied&&item.url.endsWith(suffix));assert.ok(call,`Expected request ending ${suffix}; got ${calls.map(item=>item.url).join(', ')}`);call.replied=true;return call;};
  async function tick(ms){const timer=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(timer,`Expected ${ms}ms timer`);timers.delete(timer[0]);timer[1].callback();await flush();}
  return {context,node,calls,animations,timers,storage,listeners,reply,next,tick};
}
async function phone(){
  const h=harness();vm.runInContext(`${phoneSource}\nglobalThis.api={state,submit,refresh,applySession,stopSession};`,h.context);
  await h.reply(h.next('/round-one'),snapshot());
  await h.reply(h.next('/join'),snapshot());
  assert.equal(h.context.api.state.view,'ready');assert.equal(h.context.api.state.joined,true);
  return {...h,api:h.context.api};
}
async function screen(){
  const h=harness(),received=[],delivered=[],selected=[];
  h.storage.set('between-nfc-control','isolated-test-control');
  h.context.mountWaitingShuffle=()=>({start(){},stop(){},destroy(){}});
  h.context.receivePhoneCard=card=>{const pending=deferred();received.push({card,...pending});return pending.promise;};
  let cancelled=0;h.context.cancelCardHandoff=()=>{cancelled++;};
  vm.runInContext(`${entrySource}\nglobalThis.mount=mountScanEntry;`,h.context);
  const entry=h.context.mount((...args)=>delivered.push(args),()=>{},card=>selected.push(card),{online:true});
  await h.reply(h.next('/api/sessions'),{id:'round-one',owner_token:'test-owner',phone_url:'https://example.test/phone.html?session=round-one',request_id:snapshot().request_id});
  await h.reply(h.next('/publish'),{});
  await h.reply(h.next('/round-one'),snapshot());
  return {...h,entry,received,delivered,selected,get cancelled(){return cancelled;}};
}

test('phone keeps the card until /cards confirms and duplicate clicks share one submission',async()=>{
  const h=await phone();h.api.submit();h.api.submit();await flush();
  const requests=h.calls.filter(call=>call.url.endsWith('/cards'));
  assert.equal(requests.length,1);assert.equal(requests[0].body.handoff_required,false);
  assert.deepEqual(requests[0].body.cards,[6]);
  assert.equal(h.api.state.view,'sending');assert.equal(h.api.state.departed,false);
  assert.equal(h.animations.length,0);assert.equal(h.calls.some(call=>call.url.endsWith('/handoff')),false);
});

test('confirmed submission starts departure without a second /handoff round trip',async()=>{
  const h=await phone();const sending=h.api.submit();
  await h.reply(h.next('/cards'),committed());
  assert.equal(h.api.state.view,'departing');assert.equal(h.animations.length,1);
  assert.equal(h.api.state.departed,false);assert.equal(h.calls.some(call=>call.url.endsWith('/handoff')),false);
  h.animations[0].resolve();await sending;
  assert.equal(h.api.state.view,'submitted');assert.equal(h.api.state.departed,true);
  assert.equal(h.calls.some(call=>call.url.endsWith('/handoff')),false);
});

test('failed submission cannot animate or report successful delivery',async()=>{
  const h=await phone();const sending=h.api.submit();
  await h.reply(h.next('/cards'),{error:'temporary outage'},503);await sending;
  assert.equal(h.animations.length,0);assert.equal(h.api.state.departed,false);
  assert.equal(h.api.state.uncertain,true);assert.equal(h.node('error').hidden,false);
  assert.equal(h.calls.some(call=>call.url.endsWith('/handoff')),false);
  assert.notEqual(h.api.state.view,'submitted');assert.notEqual(h.api.state.view,'accepted');
});

test('older submitted sessions with handoff_ready:false finish their handoff after departure',async()=>{
  const h=await phone();h.api.applySession(committed({handoff_ready:false}));await flush();
  assert.equal(h.animations.length,1);assert.equal(h.calls.some(call=>call.url.endsWith('/handoff')),false);
  h.animations[0].resolve();await flush();
  const handoff=h.next('/handoff');assert.ok(handoff.body.participant_id);
  await h.reply(handoff,committed());
  assert.equal(h.api.state.view,'submitted');assert.equal(h.api.state.departed,true);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/handoff')).length,1);
});

test('closed phone session ignores an earlier pending submission response',async()=>{
  const h=await phone();const sending=h.api.submit();const pending=h.next('/cards');
  h.api.stopSession('closed');await h.reply(pending,committed());
  assert.equal(h.animations.length,0,'An expired round must not fly out on a late response');
  await sending;assert.equal(h.api.state.stopped,true);assert.equal(h.api.state.departed,false);
  assert.equal(h.node('error').hidden,false);
});

test('desktop polls at 250ms, receives once and starts AI once with the same request id',async()=>{
  const h=await screen();await h.tick(250);await h.reply(h.next('/round-one'),committed());
  assert.equal(h.received.length,1);assert.equal(h.received[0].card,6);assert.equal(h.delivered.length,0);
  h.received[0].resolve();await flush();
  assert.deepEqual(h.delivered,[[6,5,snapshot().request_id]]);
  await h.reply(h.next('/ack'),{});
  // A reconnect can return the same committed snapshot before an acknowledgement is reflected.
  h.node('retryEntry').onclick();await flush();
  await h.reply(h.next('/round-one'),committed());await h.reply(h.next('/publish'),{});
  await h.reply(h.next('/round-one'),committed());await h.reply(h.next('/ack'),{});
  assert.equal(h.received.length,1);assert.deepEqual(h.delivered,[[6,5,snapshot().request_id]]);
});

test('desktop reset discards a pending poll from the previous round',async()=>{
  const h=await screen();await h.tick(250);const pending=h.next('/round-one');
  const resetting=h.entry.reset();await h.reply(h.next('/close'),{});await resetting;
  await h.reply(pending,committed());
  assert.equal(h.received.length,0);assert.equal(h.delivered.length,0);
  assert.equal(h.storage.has('between-screen-session'),false);assert.equal(h.cancelled,1);
  assert.equal(h.calls.some(call=>call.url.endsWith('/ack')),false);
});

test('desktop reset during receipt suppresses AI and acknowledgement for the old round',async()=>{
  const h=await screen();await h.tick(250);await h.reply(h.next('/round-one'),committed());
  assert.equal(h.received.length,1);
  const resetting=h.entry.reset();await h.reply(h.next('/close'),{});await resetting;
  h.received[0].resolve();await flush();
  assert.equal(h.delivered.length,0);assert.equal(h.cancelled,1);
  assert.equal(h.calls.some(call=>call.url.endsWith('/ack')),false);
});
