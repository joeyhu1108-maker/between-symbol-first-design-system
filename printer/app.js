import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { timeline, smooth, clamp } from './timeline.js';
import { makeUniverse,themeAt } from './garden_universe.js';
import { rarityFor } from './rarity.js';
import { FrontPrinterEffects } from './printer_effects.js?v=rear-corners-20260913';
import { addPrinterMechanics } from './printer_mechanics.js?v=rear-corners-20260913';
import { createCardFusion } from './card_fusion.js?v=card-fusion-1';
import { createJob,waitForJob } from '../bridge.js?v=cloud-queue-1';

const $=id=>document.getElementById(id), query=new URLSearchParams(location.search);
// Card ids and names follow ../game-cards.js, the twelve BETWEEN relationship cards.
const cardIds=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
const names=['种子','陨石','土壤','光源','河流','镜面','根系','花园','回声','边界','休眠','未知'];
// ?embed=1: running inside the symbol console (../bridge.js). Only the theatre shows; the host starts printing and receives progress.
const embed=query.has('embed')&&parent!==window;
if(embed)document.documentElement.classList.add('embed');
const notifyHost=(event,detail={})=>{if(embed)parent.postMessage({type:'between-printer',event,...detail},location.origin)};
let archivedJob=null;
if(query.has('job')){
 try{archivedJob=await api('/api/jobs/'+encodeURIComponent(query.get('job')))}
 catch(error){$('status').textContent=error.message;notifyHost('error',{message:error.message});throw error}
}
const params=archivedJob?{...archivedJob.params}:{m:Number(query.get('m')||3),n:Number(query.get('n')||5),a:Number(query.get('a')||.8),b:Number(query.get('b')||.6),seed:Number(query.get('seed')||7310926)};
const state={loaded:false,running:false,mode:query.get('mode')==='live'?'live':'rehearsal',job:null,readyAt:null,failed:false,elapsed:0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,sound:false,phase:'idle',fps:0};
let startClock=0,forcedTime=null,lastChapter='',audioContext=null,film=null,particleData=null,texture=null,orbitOffset=0,dragX=null,universePhase=performance.now()/1000,lastTheme=-1;
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
function checkParams(){if(!Number.isInteger(params.m)||!Number.isInteger(params.n)||params.m<1||params.n>12||params.n<1||params.m>12||params.m===params.n||!Number.isFinite(params.a)||!Number.isFinite(params.b))throw Error('输入参数无效，请返回显影台重新选择');}
checkParams();
const rarity=rarityFor(params.m,params.n);
$('rarityBadge').dataset.kind=rarity.kind;
$('rarityBadge').innerHTML=`<b>${rarity.label}</b><span>合 ${rarity.sum} · ${rarity.ways}/66（${rarity.percent}%）</span>`;
$('cardA').textContent=cardIds[params.m-1]; $('cardB').textContent=cardIds[params.n-1];
$('cardNames').textContent=names[params.m-1]+' · '+names[params.n-1];
$('modes').textContent=`${params.m.toString().padStart(2,'0')} / ${params.n.toString().padStart(2,'0')}`;
$('seed').textContent=(params.seed>>>0).toString(16).toUpperCase().padStart(8,'0');
$('modeLabel').textContent=state.mode==='live'?'真实生成时序':'25 秒完整预演';
if(query.has('debug')) $('lab').hidden=false;
$('timing').value=state.mode;

const viewport=$('viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.15)); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=.98;
renderer.shadowMap.enabled=false;
viewport.appendChild(renderer.domElement);
renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','三维打印机：拖动旋转，滚轮缩放，双击回到正面');renderer.domElement.style.touchAction='pan-y';
const scene=new THREE.Scene();
const pmrem=new THREE.PMREMGenerator(renderer); const env=new RoomEnvironment();
scene.environment=pmrem.fromScene(env,.06).texture; env.dispose(); pmrem.dispose();
const camera=new THREE.PerspectiveCamera(36,1,.01,20);
const target=new THREE.Vector3(0,.115,.015);
scene.add(new THREE.HemisphereLight(0xfff5e4,0xbca28e,1.5));
const key=new THREE.DirectionalLight(0xffefda,1.7); key.position.set(-.7,1,.8); key.castShadow=true;key.shadow.radius=4;
key.shadow.mapSize.set(1024,1024); Object.assign(key.shadow.camera,{left:-.5,right:.5,top:.65,bottom:-.2,near:.01,far:3}); key.shadow.bias=-.0002; scene.add(key);
const fill=new THREE.DirectionalLight(0xf0e9ff,1.1); fill.position.set(.7,.5,-.4); scene.add(fill);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const sc=shadowCanvas.getContext('2d'),gradient=sc.createRadialGradient(64,64,3,64,64,64);gradient.addColorStop(0,'rgba(96,72,51,0.2)');gradient.addColorStop(1,'rgba(96,72,51,0)');sc.fillStyle=gradient;sc.fillRect(0,0,128,128);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(.55,.47),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;scene.add(floor);
const assembly=new THREE.Group();scene.add(assembly); const pieces=[]; let inputPaper;
const model=await new GLTFLoader().loadAsync('./assets/printer.glb').catch(e=>{$('loading').textContent='三维模型未载入，请刷新页面';$('status').textContent='模型载入失败 · 输入参数仍然保留';errors.push(e.message);notifyHost('error',{message:'模型载入失败'});throw e});
assembly.add(model.scene);
const mechanicsReport=addPrinterMechanics(model.scene);
model.scene.updateMatrixWorld(true);
// Repeated teeth, fins and fasteners move as mechanisms; batch them to avoid hundreds of draw calls.
const originalMeshes=[];model.scene.traverse(o=>{if(o.isMesh)originalMeshes.push(o)});
const buckets=new Map();
for(const mesh of originalMeshes){
 const name=mesh.name.replaceAll('_',' '),prefix=name.match(/^(Micro serrated cutter tooth|Printhead heatsink fin|IC gullwing contact|PCB etched trace|Rear ventilation slot|Side cooling slot|Countersunk brass fixing|Slotted screw recess|Paper winding edge)/)?.[1];
 if(!prefix)continue;
 const center=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
 const side=center.x<-.02?'L':center.x>.02?'R':'C';
 const bucket=prefix+' '+side+' '+(center.y>.12?'upper':'lower')+' '+mesh.material.name;
 if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push(mesh);
}
for(const [name,list] of buckets){
 if(list.length<2)continue;
 const geometries=list.map(mesh=>{let g=mesh.geometry.clone();g.applyMatrix4(mesh.matrixWorld);if(g.index)g=g.toNonIndexed();for(const key of Object.keys(g.attributes))if(!['position','normal','uv'].includes(key))g.deleteAttribute(key);if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g});
 const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
 if(geometry){list.forEach(m=>m.removeFromParent());const mesh=new THREE.Mesh(geometry,list[0].material);mesh.name=name;model.scene.add(mesh);}
}
model.scene.updateMatrixWorld(true);
const meshes=[];model.scene.traverse(o=>{if(o.isMesh)meshes.push(o)});
let idx=0;
for(const mesh of meshes){
  const name=mesh.name.replaceAll('_',' ');
  if(name.includes('Blank output paper')){mesh.visible=false;continue;}
  const m=mesh.material.clone(); mesh.material=m;
  if(m.name.startsWith('Acrylic')){m.transmission=0;m.transparent=true;m.opacity=name.startsWith('Rear enclosure')?.72:name.includes('side cheek')?.29:name.includes('Thermoformed')?.36:.47;m.roughness=.28;m.depthWrite=false;m.forceSinglePass=true;mesh.castShadow=false;}
  else{m.roughness=Math.max(.32,m.roughness||.4);mesh.castShadow=true;}
  mesh.receiveShadow=true;
  const center=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const pivot=new THREE.Group();pivot.position.copy(center);assembly.add(pivot);pivot.attach(mesh);
  const rank=idx++;
  const side=center.x<-.015?-1:center.x>.015?1:rank%2?1:-1;
  const fixed=/Lower opal|Continuous lower gasket|Silicone vibration|Inset warm porcelain deck|Champagne chassis pan/.test(name);
  const shell=/acrylic|Acrylic|upright|Upright|hood|Hood|guide rail/.test(name);
  const phase=(rank*2.399+params.seed%37)%Math.PI*2;
  const spread=new THREE.Vector3(side*(shell?.100:.045)+Math.sin(phase)*.014,shell?.048:.050+(rank%4)*.014,Math.cos(phase)*.062);
  m.transparent=true;m.forceSinglePass=true;
  pieces.push({pivot,mesh,baseOpacity:m.opacity,base:center.clone(),spread,phase,rank,fixed,shell,name});
  if(name.includes('Blank input paper'))inputPaper=pivot;
  if(shell||/chassis pan|printhead housing|service panel/.test(name)){
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,45),new THREE.LineBasicMaterial({color:0x8f776b,transparent:true,opacity:.24}));mesh.add(edges);
  }
}
// Input-dependent orbital rails: constrained trajectories, not unconstrained debris.
const rails=new THREE.Group();scene.add(rails);
for(let i=0;i<3;i++){
 const rail=new THREE.Mesh(new THREE.TorusGeometry(.15+i*.026,.0006,5,120),new THREE.MeshBasicMaterial({color:i===1?0xc7a875:0xb7888c,transparent:true,opacity:0}));
 rail.position.y=.195;rail.rotation.set(Math.PI/2+.32*i,.2*i,params.b*.25);rails.add(rail);
}
const halo=new THREE.Mesh(new THREE.SphereGeometry(.09,32,24),new THREE.MeshPhysicalMaterial({color:0xe0a4ae,transparent:true,opacity:.14,roughness:.6,transmission:0,depthWrite:false}));halo.position.set(0,.19,0);scene.add(halo);
const N=2400;const particlePositions=new Float32Array(N*3),origins=new Float32Array(N*3),colours=new Float32Array(N*3);
let seed=params.seed>>>0;function random(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<N;i++){
  const az=random()*Math.PI*2,z=random()*2-1,r=.032+random()*.10;
  origins[i*3]=Math.sqrt(1-z*z)*Math.cos(az)*r;origins[i*3+1]=.19+z*r;origins[i*3+2]=Math.sqrt(1-z*z)*Math.sin(az)*r;
  const c=new THREE.Color(i%8===0?0xa89365:i%3===0?0xc8929b:0x9c6670);c.toArray(colours,i*3);
}
const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));pg.setAttribute('color',new THREE.BufferAttribute(colours,3));
const points=new THREE.Points(pg,new THREE.PointsMaterial({size:.0018,vertexColors:true,transparent:true,opacity:0,depthWrite:false,depthTest:false}));points.renderOrder=4;scene.add(points);
// Editable mesh -> anisotropic Gaussian colour splats -> editable mesh.
// These are sampled surface splats, not a trained photographic 3DGS reconstruction.
const owners=[],localSamples=[],splatColors=[],splatSizes=[],splatAngles=[],splatAspects=[],splatPhases=[],splatField=[];
for(const p of pieces){
 if(p.name.includes('Blank input'))continue;
 const mesh=p.mesh,g=mesh.geometry,position=g.attributes.position,index=g.index;
 mesh.updateMatrix();
 const triangles=(index?index.count:position.count)/3;
 const count=p.shell?850:/chassis|head|pan|roll|PCB/.test(p.name)?240:35;
 const cdf=new Float64Array(triangles);let areaSum=0;
 for(let f=0;f<triangles;f++){const a=index?index.getX(f*3):f*3,b=index?index.getX(f*3+1):f*3+1,c=index?index.getX(f*3+2):f*3+2;const ux=position.getX(b)-position.getX(a),uy=position.getY(b)-position.getY(a),uz=position.getZ(b)-position.getZ(a),vx=position.getX(c)-position.getX(a),vy=position.getY(c)-position.getY(a),vz=position.getZ(c)-position.getZ(a);areaSum+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)*.5;cdf[f]=areaSum;}
 if(areaSum<=1e-14)continue;
 for(let j=0;j<count;j++){
  const wanted=random()*areaSum;let lo=0,hi=triangles-1;while(lo<hi){const mid=(lo+hi)>>1;if(cdf[mid]<wanted)lo=mid+1;else hi=mid;}const tri=lo*3;
  const ids=[0,1,2].map(k=>index?index.getX(tri+k):tri+k);
  let u=random(),v=random();if(u+v>1){u=1-u;v=1-v;}
  const sample=new THREE.Vector3();
  for(let k=0;k<3;k++){const w=k===0?1-u-v:k===1?u:v;sample.x+=position.getX(ids[k])*w;sample.y+=position.getY(ids[k])*w;sample.z+=position.getZ(ids[k])*w;}
  sample.applyMatrix4(mesh.matrix);owners.push(p);localSamples.push(sample.x,sample.y,sample.z);
  const color=mesh.material.color.clone().lerp(new THREE.Color(p.shell?0xdcb0b1:0xbcaa8b),p.shell?.35:.12);
  splatColors.push(color.r,color.g,color.b);splatSizes.push(.0010+random()*.0018);splatAngles.push(random()*Math.PI);splatAspects.push(.35+random()*.55);splatPhases.push(random()*Math.PI*2);
  const x=clamp((sample.x+p.base.x+.12)/.24),y=clamp((sample.y+p.base.y)/.25);
  splatField.push(Math.abs(params.a*Math.cos(Math.PI*params.m*x)*Math.cos(Math.PI*params.n*y)+params.b*Math.cos(Math.PI*params.n*x)*Math.cos(Math.PI*params.m*y)));
 }
}
const sg=new THREE.BufferGeometry(),sp=new Float32Array(localSamples.length);
sg.setAttribute('position',new THREE.BufferAttribute(sp,3));sg.setAttribute('color',new THREE.Float32BufferAttribute(splatColors,3));
sg.setAttribute('aSize',new THREE.Float32BufferAttribute(splatSizes,1));sg.setAttribute('aAngle',new THREE.Float32BufferAttribute(splatAngles,1));sg.setAttribute('aAspect',new THREE.Float32BufferAttribute(splatAspects,1));
const splatMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{uOpacity:{value:0},uHeight:{value:700},uSizeScale:{value:1}},
 vertexShader:`attribute float aSize;attribute float aAngle;attribute float aAspect;uniform float uHeight;uniform float uSizeScale;varying vec3 vColor;varying float vAngle;varying float vAspect;void main(){vColor=color;vAngle=aAngle;vAspect=aAspect;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*uSizeScale*uHeight*projectionMatrix[1][1]/max(.05,-mv.z),2.0,30.0);}`,
 fragmentShader:`uniform float uOpacity;varying vec3 vColor;varying float vAngle;varying float vAspect;void main(){vec2 q=(gl_PointCoord-.5)*2.0;float c=cos(vAngle),s=sin(vAngle);q=mat2(c,-s,s,c)*q;q.y/=vAspect;float alpha=exp(-3.0*dot(q,q))*uOpacity;if(alpha<.009)discard;gl_FragColor=vec4(vColor,alpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`
});
const splats=new THREE.Points(sg,splatMaterial);splats.frustumCulled=false;scene.add(splats);
const universe=makeUniverse(owners.length,params),modelColors=new Float32Array(splatColors),gardenColors=new Float32Array(universe.colors);
points.visible=false;halo.visible=false;
function sampleGardenColors(image){
 const c=document.createElement('canvas');c.width=112;c.height=192;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);
 const pixels=ctx.getImageData(0,0,c.width,c.height).data,col=new THREE.Color();
 for(let i=0;i<owners.length;i++){const x=Math.floor(universe.uv[i*2]*111),y=Math.floor(universe.uv[i*2+1]*191),k=(y*112+x)*4;col.setRGB(pixels[k]/255,pixels[k+1]/255,pixels[k+2]/255,THREE.SRGBColorSpace);col.toArray(gardenColors,i*3);}
}

// The same numbered raster is mapped onto the physically curved output paper.
const cols=12,rows=80;const paperGeometry=new THREE.PlaneGeometry(.126,.216,cols,rows);
const pos=paperGeometry.attributes.position;
for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
 const t=j/rows; pos.setXYZ(j*(cols+1)+i,(i/cols-.5)*.126,.070-.062*(t*t*(3-2*t))+.003*t**10,.061+.194*t);
}
paperGeometry.computeVertexNormals();paperGeometry.setDrawRange(0,0);
const output=new THREE.Mesh(paperGeometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false}));scene.add(output);
const printerFx=new FrontPrinterEffects({renderer,scene,camera,assembly,pieces,owners,localSamples,splatPhases,modelColors,gardenColors,universe,sg,sp,splats,splatMaterial,output,paperGeometry,floor,halo,points,rails});
let cardFusion=null;
if(query.get('intro')==='cards'){
 try{cardFusion=await createCardFusion({scene,renderer,ids:(params.cards?.length===2?params.cards:[params.m,params.n]).map(id=>String(id).padStart(2,'0'))});cardFusion.reset(state.reduced);}
 catch(error){$('status').textContent='卡片未能载入，请重新尝试';errors.push(error.message);notifyHost('error',{message:'卡片未能载入，请重新尝试'});throw error;}
 addEventListener('pagehide',()=>cardFusion.dispose(),{once:true});
}

function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);resize();
state.loaded=true;$('loading').style.display='none';$('start').disabled=false;
$('motion').textContent=state.reduced?'恢复完整动态':'减少动态';
$('status').textContent='输入已载入 · 模型与生成器已准备好';

function soundNote(phase){
 if(!state.sound)return;
 audioContext ||= new AudioContext();audioContext.resume();
 const tones={receive:220,unfold:330,grow:440,gather:550,print:660,complete:880};
 const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=tones[phase]||220;
 g.gain.setValueAtTime(0,audioContext.currentTime);g.gain.linearRampToValueAtTime(.025,audioContext.currentTime+.06);g.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.7);
 o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.72);
}
const copy={
 cosmos:['01 / 04','一颗种子，<br>一个未定的宇宙。','所有可能性混在一起。你的两种模态，让这片立体粒子场持续旋转、彼此牵引。'],
 coalesce:['02 / 04','宇宙开始，<br>借用一种形状。','同一批色粒沿着各自的轨迹聚拢，一台半透明的打印机渐渐显现。'],
 printer:['02 / 04','形状，<br>只是短暂的停留。','粒子暂时成为机器。它已经承接你的种子，也准备再次改变自己。'],
 garden:['03 / 04','让偶然，<br>长成一座花园。','结构重新流动。色域交叠、线条游走，种子进入一片没有既定形状的花园。'],
 print:['04 / 04','这座花园，<br>只在此刻发生。','抽象的色彩关系落到纸上。留下编号，保存这次由你开始的相遇。'],
 complete:['04 / 04','你的种子，<br>已经落进花园。','作品与输入变量已一同归档，可以保存文件，或在连接纸张打印机后继续打印。'],
 failed:['—','这次生长，<br>暂时停了一下。','种子和输入仍然保留。你可以重试，不必重新选择。']
};
const rarityCopy={
 origin:{cosmos:['01 / 04','极少的相遇，<br>从一点开始。','合为 3。极值花园从少量色粒展开，给尚未发生的生长留下大片空白。'],garden:['03 / 04','让尚未长成的，<br>保持空白。','这一次只留下少量粉紫残片、细微磨损和柔软的空域。稀少本身成为作品的一部分。']},
 palimpsest:{cosmos:['01 / 04','许多可能，<br>同时抵达。','合为 23。更密集的粒子与层叠轨道汇聚，形成这次极值的丰盛结构。'],garden:['03 / 04','盛放之后，<br>痕迹仍在生长。','粉紫色域反复覆盖，颜料破损处露出旧层。密集的花园，保存积累与消退的痕迹。']},
 rare:{garden:['03 / 04','一次偏离，<br>让花园不同。','一处断裂、一个偏移的色岛，改变原来的生长方向。它属于较少出现的和数区间。']}
};
const phaseCopy=phase=>phase==='garden'&&state.job?.story?['03 / 04',state.job.story.screen_title,state.job.story.screen_line]:rarityCopy[rarity.kind]?.[phase]||copy[phase];
function narrate(tl){
 if(query.has('fxreview')){
  const phase=printerFx.state.phase;
  const c={assembly:['01 / 04','零件靠近，<br>结构逐层归位。','底盘、传动与外壳依次对齐扣合。拖动可从不同角度观察装配。'],assembled:['02 / 04','结构已就位，<br>等待第一笔。','齿轮、压纸轴与切刀，在半透明外壳内组成一条真实的纸路。'],printing:['03 / 04','机械运转，<br>颜色开始流动。','高斯色粒进入打印状态，近处清晰饱满，远处柔和淡去。'],complete:['04 / 04','纸张落下，<br>留下这次相遇。','作品已出纸。拖动继续查看，双击回到正面。']}[phase];
  if(c&&lastChapter!==phase){lastChapter=phase;$('chapter').textContent=c[0];$('title').innerHTML=c[1];$('description').textContent=c[2];}
  const active={assembly:0,assembled:1,printing:2,complete:3}[phase];
  document.querySelectorAll('[data-step]').forEach((el,i)=>{el.classList.toggle('active',i===active);el.classList.toggle('done',i<active)});
  $('elapsed').textContent=tl.complete?'PRINT / 完成':`${Math.floor(tl.elapsed).toString().padStart(2,'0')} s · 25 秒机械预演`;
  return;
 }

 if(lastChapter!==tl.phase){lastChapter=tl.phase;state.phase=tl.phase;soundNote(tl.phase);const c=phaseCopy(tl.phase);if(c){$('chapter').textContent=c[0];$('title').innerHTML=c[1];$('description').textContent=c[2];}}
 const active={cosmos:0,coalesce:1,printer:1,garden:2,print:3,complete:3}[tl.phase];
 document.querySelectorAll('[data-step]').forEach((el,i)=>{el.classList.toggle('active',i===active);el.classList.toggle('done',i<active)});
 if(tl.overdue)$('status').textContent='花园仍在生成 · 种子已保存，无需重新提交';
 $('elapsed').textContent=tl.complete?'GARDEN / 已归档':`${Math.floor(tl.elapsed).toString().padStart(2,'0')} s · ${state.mode==='rehearsal'?'25 秒完整预演':'按实际生成状态推进'}`;
}
function pose(t,tl){
 const printerTime=Math.max(0,t-(cardFusion?.offset||0));
 printerFx.update(printerTime,tl,{reduced:state.reduced,hasArtwork:!!texture&&state.readyAt!==null&&state.job?.status==='ready',clock:state.running?universePhase+printerTime:performance.now()/1000,density:rarity.density});
 if(cardFusion){
  const idle=tl.phase==='idle';
  assembly.visible=!idle&&t>=cardFusion.offset;
  cardFusion.update(t,camera,idle);
 }
 const theme=themeAt(1);if(lastTheme!==1){lastTheme=1;for(const [key,value] of Object.entries({bg:theme.bg,ink:theme.ink,muted:theme.muted,accent:theme.accent}))document.body.style.setProperty('--world-'+key,`rgb(${value.join(',')})`);}
}
function showError(message){state.failed=true;state.running=false;$('status').textContent=message;$('status').classList.add('failed');$('start').disabled=false;$('start').textContent='用同一组输入重试 ↗';narrate(timeline(state.elapsed,{failed:true}));notifyHost('error',{message});}
async function api(url,data){const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:undefined);const out=await r.json();if(!r.ok)throw Error(out.error||'服务暂时不可用');return out;}
async function adoptJob(job){
 state.job=job;$('sceneSerial').textContent=job.id;
 Object.assign(params,job.params);$('seed').textContent=(params.seed>>>0).toString(16).toUpperCase().padStart(8,'0');
 if(job.generator==='ai_imagegen')$('modeLabel').textContent='花园 / AI 风格样张';
 particleData=await(await fetch(job.particles)).json();
 const next=await new THREE.TextureLoader().loadAsync(job.image);next.colorSpace=THREE.SRGBColorSpace;next.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 texture?.dispose();texture=next;sampleGardenColors(next.image);output.material.map=texture;output.material.needsUpdate=true;
 if(job.story){const s=job.story;$('storyTitle').textContent=s.title;$('storyBody').textContent=s.story;$('storyQuestion').textContent=s.question;$('storyClues').textContent=s.cards.map(c=>c.index+' · '+c.name+'：'+c.wish).join('；')+'。'+s.perspective+'；'+s.relation+'。本次留下：'+s.signature+'。';}
 $('download').href=job.pdf;sessionStorage.setItem('seed-press-job',job.id);
}
async function poll(jid,mode){
 try{
  const job=await waitForJob(jid,current=>{
   if(state.job?.id!==jid)return;
   state.job=current;
   if(mode==='failure'&&state.elapsed>5)throw Error('验证场景：生成服务暂时不可用。真实任务与参数已经保存。');
  });if(state.job?.id!==jid)return;
  if(job.status==='failed')throw Error(job.error);
  if(job.status==='ready'&&!(mode==='slow'&&state.elapsed<40)&&mode!=='failure'){
    await adoptJob(job);state.readyAt=(performance.now()-startClock)/1000;
    $('status').textContent=state.mode==='rehearsal'?'作品文件已准备好 · 正在播放完整重组过程':'作品文件已准备好 · 正在收束并交付';return;
  }
  setTimeout(()=>poll(jid,mode),650);
 }catch(e){showError(e.message);}
}
function begin(){printerFx.resetView();cardFusion?.reset(state.reduced);state.running=true;state.failed=false;state.elapsed=0;forcedTime=null;orbitOffset=0;universePhase=performance.now()/1000;startClock=performance.now();lastChapter='';document.body.classList.remove('has-result');$('result').hidden=true;$('storyPanel').hidden=true;$('start').disabled=true;$('start').textContent='花园正在发生';$('status').classList.remove('failed');}
async function start(){
 if(!state.loaded||state.running)return;
 if(state.job?.status==='ready'&&!state.failed){begin();state.readyAt=0;$('status').textContent='正在回放已归档作品';return;}
 if(state.job?.status==='failed')state.requestId=null;
 state.readyAt=null;state.job=null;begin();
 try{
  state.mode=query.has('debug')?$('timing').value:state.mode;$('modeLabel').textContent=state.mode==='rehearsal'?'25 秒完整预演':state.mode==='live'?'真实生成时序':'时序验证';
  state.requestId??=typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  state.job=await createJob(params.cards?.length===2?params.cards:[params.m,params.n],state.requestId);$('sceneSerial').textContent=state.job.id;
  $('status').textContent='种子已保存 · 正在计算显影图与编号打印文件';poll(state.job.id,state.mode);
 }catch(e){showError(e.message);}
}
async function refreshPrinters(){try{const {printers}=await api('/api/printers');$('printer').replaceChildren();const none=new Option(printers.length?'选择纸张打印机':'未连接纸张打印机','');$('printer').add(none);printers.forEach(p=>$('printer').add(new Option(p,p)));$('print').disabled=!printers.length;}catch{$('print').disabled=true;}}
$('start').onclick=start;
$('motion').onclick=()=>{state.reduced=!state.reduced;$('motion').textContent=state.reduced?'恢复完整动态':'减少动态'};
$('sound').onclick=()=>{state.sound=!state.sound;$('sound').setAttribute('aria-pressed',state.sound);$('sound').textContent='声音 · '+(state.sound?'开':'关');if(state.sound)soundNote('receive');};
$('refreshPrinters').onclick=refreshPrinters;
$('timing').onchange=()=>{if(state.running)return;state.job=null;state.failed=false;state.mode=$('timing').value;$('start').textContent='让种子落下 ↗';};
$('print').onclick=async()=>{
 if(!state.job||!$('printer').value){$('status').textContent='请先连接并选择纸张打印机';return;}
 $('print').disabled=true;
 try{const job=await api('/api/jobs/'+state.job.id+'/print',{printer:$('printer').value});state.job=job;$('status').textContent=job.print_status==='submitted'?`已交给打印队列 ${job.cups_job_id} · 请到设备确认出纸`:job.print_error||'打印状态待确认，请检查系统队列';if(job.print_status==='failed')$('print').disabled=false;}
 catch(e){$('status').textContent=e.message;$('print').disabled=false;}
};
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();showError('图形显示已中断，作品编号仍然保存；请刷新恢复')});
let lastFrame=performance.now(),frameCount=0,fpsClock=lastFrame,lastPost=0;
function animate(now){requestAnimationFrame(animate);frameCount++;if(now-fpsClock>1000){state.fps=Math.round(frameCount*1000/(now-fpsClock));frameCount=0;fpsClock=now;}
 if(state.running)state.elapsed=forcedTime??(now-startClock)/1000;
 const introOffset=cardFusion?.offset||0,printerTime=Math.max(0,state.elapsed-introOffset);
 const tl=state.running||state.phase==='complete'?timeline(printerTime,{mode:state.mode,readyAt:state.readyAt===null?null:Math.max(0,state.readyAt-introOffset),failed:state.failed}):{form:0,bloom:0,landing:0,print:0,phase:'idle'};
 pose(state.elapsed,tl);printerFx.render();
 if(state.running){narrate(tl);if(embed&&now-lastPost>200){lastPost=now;notifyHost('progress',{phase:cardFusion&&state.elapsed<cardFusion.duration?'fusion':tl.phase,progress:tl.complete?1:Math.min(.99,state.elapsed/(tl.reveal+7+introOffset))});}if(tl.complete){state.running=false;state.phase='complete';document.body.classList.add('has-result');$('result').hidden=false;$('storyPanel').hidden=!state.job?.story;$('start').disabled=false;$('start').textContent='再走进一次花园 ↗';$('status').textContent='作品已生成并保存 · 等待连接纸张打印机';refreshPrinters();notifyHost('complete',{job:state.job?.id});}}
 if(film){if(query.has('fxreview'))printerFx.drawReviewFrame(film);else drawFilm(film,tl);}lastFrame=now;
}
requestAnimationFrame(animate);
function drawFilm(c,tl){
 const ctx=c.getContext('2d'),theme=themeAt(tl.form??0);ctx.fillStyle=`rgb(${theme.bg})`;ctx.fillRect(0,0,1280,720);
 const src=renderer.domElement,scale=Math.min(870/src.width,650/src.height);ctx.drawImage(src,20,35,src.width*scale,src.height*scale);
 ctx.fillStyle=`rgb(${theme.muted})`;ctx.font='12px Georgia';ctx.fillText('GARDEN / A SEED BECOMES A WORLD',880,110);
 ctx.fillStyle=`rgb(${theme.accent})`;ctx.font='40px Georgia';ctx.fillText(cardIds[params.m-1]+' × '+cardIds[params.n-1],880,175);
 const lines=phaseCopy(tl.phase)?.[1].split('<br>')||['一颗种子','一个未定的宇宙。'];ctx.fillStyle=`rgb(${theme.ink})`;ctx.font='33px "Songti SC",serif';lines.forEach((v,i)=>ctx.fillText(v,880,275+i*49));
 ctx.fillStyle=`rgb(${theme.muted})`;ctx.font='13px sans-serif';ctx.fillText(rarity.label,880,407);ctx.fillText('SUM '+rarity.sum+' / '+rarity.ways+'/66 ('+rarity.percent+'%)',880,443);
 ctx.strokeStyle='#d2bca9';ctx.beginPath();ctx.moveTo(70,650);ctx.lineTo(1210,650);ctx.stroke();ctx.font='12px sans-serif';ctx.fillStyle=`rgb(${theme.muted})`;ctx.fillText('01 宇宙     02 凝形     03 花园     04 落纸',70,685);
 ctx.font='10px monospace';ctx.fillText(state.job?.id||'',880,595);
}
async function record(){
 if(!state.job||!texture)throw Error('请先生成一件作品再录制');
 state.mode='rehearsal';begin();state.readyAt=0;
 film=document.createElement('canvas');film.width=1280;film.height=720;
 const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
 const stream=film.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000});const chunks=[];
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 const end=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
 await new Promise(resolve=>setTimeout(resolve,25050));recorder.stop();await end;stream.getTracks().forEach(t=>t.stop());
 const blob=new Blob(chunks,{type:mime});const response=await fetch('/api/recording',{method:'POST',body:blob});if(!response.ok)throw Error('录像保存失败');film=null;return {seconds:25,bytes:blob.size};
}
window.experience={state,params,rarity,start,record,errors,debug:{scene,camera,renderer,pieces,printerFx,mechanicsReport},seek(t){state.running=true;forcedTime=t;state.elapsed=t;startClock=performance.now()-t*1000;$('result').hidden=true;document.body.classList.remove('has-result');},resume(){forcedTime=null;startClock=performance.now()-state.elapsed*1000;},stats(){return {fps:state.fps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,meshes:pieces.length,gaussianSplats:owners.length,visibleSplats:sg.drawRange.count,rarity:rarity.kind,printerEffect:printerFx.state,phase:state.phase}}};
let embedReady=false,embedStarted=false;
if(embed)addEventListener('message',e=>{if(embedReady&&!embedStarted&&e.source===parent&&e.origin===location.origin&&e.data?.type==='between-printer-start'){embedStarted=true;start();}});
if(archivedJob){try{const j=archivedJob;if(j.status==='ready'&&(j.style_version?.startsWith('garden-v1')||query.has('fxreview'))){await adoptJob(j);state.readyAt=0;state.elapsed=0;state.mode=query.get('mode')==='live'?'live':'rehearsal';state.running=false;state.phase='idle';$('status').textContent='花园样张已载入 · 点击让种子落下';
 if(!embed){document.body.classList.add('has-result');$('result').hidden=false;$('storyPanel').hidden=!j.story;$('start').disabled=false;$('start').textContent='重播这件作品 ↗';$('status').textContent='作品已保存 · 可下载 PDF 或选择纸张打印机';refreshPrinters();}
 embedReady=true;notifyHost('ready',{job:j.id});}else{$('status').textContent='当前是旧版样张，点击开始生成新的花园';notifyHost('error',{message:'作品尚未就绪'});}}catch(e){$('status').textContent=e.message;notifyHost('error',{message:e.message});}}

if(query.has('fxreview')){
 document.title='花园 · 打印机机械剧场';
 $('modeLabel').textContent='3D 结构与打印效果';
 $('chapter').textContent='00 / 04';$('title').innerHTML='从外壳，<br>看到内部。';
 $('description').textContent='拖动旋转视角，滚轮靠近或远离，双击回到正面。让齿轮、弹簧与纸路逐层重组，进入一次打印。';
 $('status').textContent='机械结构已载入 · 拖动查看或开始播放';
 $('start').innerHTML='开始重组打印 <span>↗</span>';
 ['分层装配','结构就位','显影运转','作品落纸'].forEach((label,i)=>document.querySelector(`[data-step="${i}"]`).innerHTML=`<b>0${i+1}</b> ${label}`);
}
