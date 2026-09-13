import glyphs from './src/manifest.mjs';
import {createSymbol} from './player.mjs';
const $=s=>document.querySelector(s);
let hero,atoms=[],chosen='01',revision=0,speed=1,paused=false;
const params=new URLSearchParams(location.search),deterministic=params.has('static')||params.has('t');
$('#symbol-grid').innerHTML=glyphs.map(g=>`<button class="glyph-tile" type="button" data-id="${g.id}" aria-label="${g.name} · ${g.relation}，播放动态" aria-pressed="false"><span class="tile-top"><span class="tile-index">${g.id}</span><span class="selected-dot"></span></span><span class="tile-art"></span><span class="tile-label">${g.name}<small>${g.relation}</small></span></button>`).join('');
async function select(id,play=false){
 const run=++revision;chosen=id;const glyph=glyphs.find(g=>g.id===id);
 hero?.destroy();atoms.forEach(a=>a.destroy());atoms=[];
 document.querySelectorAll('.glyph-tile').forEach(el=>el.setAttribute('aria-pressed',el.dataset.id===id));
 $('#symbol-name').innerHTML=`${glyph.name}<span>${glyph.relation}</span>`;$('#symbol-verb').textContent=glyph.verb;$('#symbol-story').textContent=glyph.story;$('#current-index').textContent=`${id} / 12`;
 $('#logo-root').setAttribute('aria-label',`播放${glyph.name}的完整动作`);$('#json-link').href=`./animations/${id}.json`;$('#svg-link').href=`./vectors/${id}.svg`;$('#file-size').textContent=`${(glyph.bytes/1024).toFixed(0)} KB`;
 const renderSlot=document.createElement('span');renderSlot.className='hero-render';$('#logo-root').replaceChildren(renderSlot);
 const player=await createSymbol(renderSlot,id,{ambient:!deterministic,interactive:false});if(run!==revision){player.destroy();return;}hero=player;hero.setSpeed(speed);
 if(params.has('static'))hero.static();else if(params.has('t'))hero.seek(Number(params.get('t')));else if(play)hero.play('tap');
 hero.animation.addEventListener('enterFrame',()=>{$('#live-state').textContent=paused?'静止':({idle:'呼吸',hover:'回应',tap:'相遇',static:'静止'}[hero.state]||'静止');});
 for(const el of document.querySelectorAll('.study')){const atomSlot=document.createElement('span');atomSlot.className='atom-render';el.querySelector('.study-symbol').replaceChildren(atomSlot);const atom=await createSymbol(atomSlot,id,{interactive:false});if(run!==revision){atom.destroy();return;}atoms.push(atom);atom.setSpeed(speed);el.onclick=()=>{atom.play(el.dataset.mode);hero.play(el.dataset.mode);resumeLabel();};}
 window.__p2mReady=true;
}
function resumeLabel(){paused=false;$('#pause').setAttribute('aria-label','暂停动作');$('#pause').title='暂停动作';}
function rate(value){speed=value;$('#speed').value=value;$('#speed-label').textContent=`${Number(value.toFixed(2))}×`;$('#slow').setAttribute('aria-pressed',value===.25);hero?.setSpeed(value);atoms.forEach(a=>a.setSpeed(value));}
$('#speed').oninput=event=>rate(Number(event.target.value));$('#slow').onclick=()=>rate(speed===.25?1:.25);
$('#replay').onclick=()=>{hero?.play('tap');resumeLabel();};$('#logo-root').onclick=()=>{hero?.play('tap');resumeLabel();};$('#logo-root').onpointerenter=event=>{if(event.pointerType==='mouse'&&!deterministic)hero?.play('hover');};$('#logo-root').onfocus=()=>{if(!deterministic)hero?.play('hover');};
$('#pause').onclick=()=>{paused=!paused;if(paused){hero?.pause();$('#live-state').textContent='静止';$('#pause').setAttribute('aria-label','继续动作');$('#pause').title='继续动作';}else{hero?.resume();resumeLabel();}};
try{
 await select(glyphs.some(g=>g.id===params.get('symbol'))?params.get('symbol'):'01');
 await Promise.all([...document.querySelectorAll('.glyph-tile')].map(async el=>{const tile=await createSymbol(el.querySelector('.tile-art'),el.dataset.id,{interactive:false});el.onpointerenter=e=>{if(e.pointerType==='mouse'&&!deterministic)tile.play('hover');};el.onfocus=()=>{if(!deterministic)tile.play('hover');};el.onclick=()=>{tile.play('tap');select(el.dataset.id,true);resumeLabel();};}));
 document.body.dataset.ready='true';
}catch(error){$('#load-error').hidden=false;console.error(error);}
