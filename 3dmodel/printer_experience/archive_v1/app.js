import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { timeline, smooth, clamp } from './timeline.js';

const $=id=>document.getElementById(id), query=new URLSearchParams(location.search);
const roman=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const names=['愚者','魔术师','恋人','皇后','皇帝','教皇','战车','命运之轮','倒吊人','死神','隐士','世界'];
const params={m:Number(query.get('m')||3),n:Number(query.get('n')||5),a:Number(query.get('a')||.8),b:Number(query.get('b')||.6),seed:Number(query.get('seed')||7310926)};
const state={loaded:false,running:false,mode:query.get('mode')==='live'?'live':'rehearsal',job:null,readyAt:null,failed:false,elapsed:0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,sound:false,phase:'idle',fps:0};
let startClock=0,forcedTime=null,lastChapter='',audioContext=null,film=null,particleData=null,texture=null,orbitOffset=0,dragX=null;
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
function checkParams(){if(!Number.isInteger(params.m)||!Number.isInteger(params.n)||params.m<1||params.n>12||params.n<1||params.m>12||params.m===params.n||!Number.isFinite(params.a)||!Number.isFinite(params.b))throw Error('输入参数无效，请返回显影台重新选择');}
checkParams();
$('cardA').textContent=roman[params.m-1]; $('cardB').textContent=roman[params.n-1];
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
renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','三维打印机；静止时拖动或按左右方向键旋转');renderer.domElement.style.touchAction='pan-y';
renderer.domElement.addEventListener('pointerdown',e=>{if(!state.running){dragX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)}});
renderer.domElement.addEventListener('pointermove',e=>{if(dragX!==null&&!state.running){orbitOffset+=(e.clientX-dragX)*.006;dragX=e.clientX}});
renderer.domElement.addEventListener('pointerup',()=>dragX=null);renderer.domElement.addEventListener('pointercancel',()=>dragX=null);
renderer.domElement.addEventListener('keydown',e=>{if(!state.running&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();orbitOffset+=e.key==='ArrowLeft'?-.12:.12}});
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
const model=await new GLTFLoader().loadAsync('./assets/printer.glb').catch(e=>{$('loading').textContent='三维模型未载入，请刷新页面';$('status').textContent='模型载入失败 · 输入参数仍然保留';errors.push(e.message);throw e});
assembly.add(model.scene); model.scene.updateMatrixWorld(true);
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
  if(m.name.startsWith('Acrylic')){m.transmission=0;m.transparent=true;m.opacity=.47;m.roughness=.28;m.depthWrite=false;m.forceSinglePass=true;mesh.castShadow=false;}
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
 if(p.fixed||p.name.includes('Blank input'))continue;
 const mesh=p.mesh,g=mesh.geometry,position=g.attributes.position,index=g.index;
 mesh.updateMatrix();
 const triangles=(index?index.count:position.count)/3;
 const count=p.shell?850:/chassis|head|pan|roll|PCB/.test(p.name)?240:35;
 for(let j=0;j<count;j++){
  const tri=Math.floor(random()*triangles)*3;
  const ids=[0,1,2].map(k=>index?index.getX(tri+k):tri+k);
  let u=random(),v=random();if(u+v>1){u=1-u;v=1-v;}
  const sample=new THREE.Vector3();
  for(let k=0;k<3;k++){const w=k===0?1-u-v:k===1?u:v;sample.x+=position.getX(ids[k])*w;sample.y+=position.getY(ids[k])*w;sample.z+=position.getZ(ids[k])*w;}
  sample.applyMatrix4(mesh.matrix);owners.push(p);localSamples.push(sample.x,sample.y,sample.z);
  const color=mesh.material.color.clone().lerp(new THREE.Color(p.shell?0xdcb0b1:0xbcaa8b),p.shell?.35:.12);
  splatColors.push(color.r,color.g,color.b);splatSizes.push(.0017+random()*.0030);splatAngles.push(random()*Math.PI);splatAspects.push(.35+random()*.55);splatPhases.push(random()*Math.PI*2);
  const x=clamp((sample.x+p.base.x+.12)/.24),y=clamp((sample.y+p.base.y)/.25);
  splatField.push(Math.abs(params.a*Math.cos(Math.PI*params.m*x)*Math.cos(Math.PI*params.n*y)+params.b*Math.cos(Math.PI*params.n*x)*Math.cos(Math.PI*params.m*y)));
 }
}
const sg=new THREE.BufferGeometry(),sp=new Float32Array(localSamples.length);
sg.setAttribute('position',new THREE.BufferAttribute(sp,3));sg.setAttribute('color',new THREE.Float32BufferAttribute(splatColors,3));
sg.setAttribute('aSize',new THREE.Float32BufferAttribute(splatSizes,1));sg.setAttribute('aAngle',new THREE.Float32BufferAttribute(splatAngles,1));sg.setAttribute('aAspect',new THREE.Float32BufferAttribute(splatAspects,1));
const splatMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{uOpacity:{value:0},uHeight:{value:700}},
 vertexShader:`attribute float aSize;attribute float aAngle;attribute float aAspect;uniform float uHeight;varying vec3 vColor;varying float vAngle;varying float vAspect;void main(){vColor=color;vAngle=aAngle;vAspect=aAspect;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*uHeight*projectionMatrix[1][1]/max(.05,-mv.z),2.0,30.0);}`,
 fragmentShader:`uniform float uOpacity;varying vec3 vColor;varying float vAngle;varying float vAspect;void main(){vec2 q=(gl_PointCoord-.5)*2.0;float c=cos(vAngle),s=sin(vAngle);q=mat2(c,-s,s,c)*q;q.y/=vAspect;float alpha=exp(-3.0*dot(q,q))*uOpacity;if(alpha<.009)discard;gl_FragColor=vec4(vColor,alpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`
});
const splats=new THREE.Points(sg,splatMaterial);splats.frustumCulled=false;scene.add(splats);
// The same numbered raster is mapped onto the physically curved output paper.
const cols=12,rows=80;const paperGeometry=new THREE.PlaneGeometry(.126,.216,cols,rows);
const pos=paperGeometry.attributes.position;
for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
 const t=j/rows; pos.setXYZ(j*(cols+1)+i,(i/cols-.5)*.126,.070-.062*(t*t*(3-2*t))+.003*t**10,.061+.194*t);
}
paperGeometry.computeVertexNormals();paperGeometry.setDrawRange(0,0);
const output=new THREE.Mesh(paperGeometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false}));scene.add(output);

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
 receive:['01 / 04','你的选择，<br>已经抵达。','两张牌成为两种振动。一组只属于这次相遇的规则，开始进入机器。'],
 unfold:['02 / 04','先拆开，<br>才有新的可能。','亚克力外壳让出空间。金属部件沿着模态轨道展开，原有结构开始松动。'],
 grow:['03 / 04','看，它正在<br>找到自己的形状。','沙粒沿着振动的节线聚集。相同的两张牌，保留同一组模态；随机性决定这一次的个体。'],
 gather:['03 / 04','所有偶然，<br>开始相互回应。','这一次的形态已被保存。部件重新归位，准备把它交给纸张。'],
 print:['04 / 04','现在，<br>它属于你了。','同一幅显影图、同一个编号，从屏幕上的变化，成为可以带走的作品。'],
 complete:['04 / 04','这一刻，<br>有了自己的编号。','作品已经生成并归档。可以保存打印文件，或在连接纸张打印机后，直接打印这一件。'],
 failed:['—','这次显影<br>暂时中断。','你的两张牌与随机种子还在。可以重试，不必重新做选择。']
};
function narrate(tl){
 if(lastChapter!==tl.phase){lastChapter=tl.phase;state.phase=tl.phase;soundNote(tl.phase);const c=copy[tl.phase];if(c){$('chapter').textContent=c[0];$('title').innerHTML=c[1];$('description').textContent=c[2];}}
 const active={receive:0,unfold:1,grow:2,gather:2,print:3,complete:3}[tl.phase];
 document.querySelectorAll('[data-step]').forEach((el,i)=>{el.classList.toggle('active',i===active);el.classList.toggle('done',i<active)});
 if(tl.overdue){$('status').textContent='还在显影 · 你的种子已保存，无需重复提交';}
 $('elapsed').textContent=tl.complete?'ARCHIVED / 已保存':`${Math.floor(tl.elapsed).toString().padStart(2,'0')} s · ${state.mode==='rehearsal'?'25 秒完整预演':'按实际生成状态推进'}`;
}
function pose(t,tl){
 const e=tl.explosion*(state.reduced?.08:1), intake=state.running?1-smooth(0,3,t):0;
 const mist=e*smooth(4,8,t);
 const energy=(params.m+params.n-3)/20, speed=.34+energy*.45;
 assembly.rotation.y=state.reduced?0:Math.sin(t*.22)*(.07+e*.08);
 for(const p of pieces){
   p.pivot.position.copy(p.base);p.pivot.rotation.set(0,0,0);p.pivot.scale.set(1,1,1);
   if(!p.fixed){
     const theta=Math.sin(t*speed+p.phase)*(.2+Math.abs(params.b)*.35);
     const sx=p.spread.x*Math.cos(theta)-p.spread.z*Math.sin(theta),sz=p.spread.x*Math.sin(theta)+p.spread.z*Math.cos(theta);
     p.pivot.position.x+=sx*e;p.pivot.position.y+=p.spread.y*e+Math.sin(t*1.7+p.phase)*.006*e;p.pivot.position.z+=sz*e;
     p.pivot.rotation.z=e*Math.sin(t*speed+p.phase)*(.1+p.shell*.18);
     p.pivot.rotation.y=e*Math.sin(t*speed*.7+p.phase)*.35;
     if(p.shell){p.pivot.scale.x=1+e*.10*Math.sin(t*.8+p.phase);p.pivot.scale.y=1+e*.06*Math.cos(t*.8+p.phase);}
   }
   p.mesh.material.opacity=p.baseOpacity*(p.fixed?1:1-mist*.68);p.mesh.material.depthWrite=p.mesh.material.opacity>.98;
 }
 if(inputPaper){inputPaper.visible=!state.running&&state.phase==='idle'||state.running&&t<3;if(state.running)inputPaper.position.y-=smooth(0,3,t)*.15;}
 rails.visible=e>.002;rails.rotation.y=t*.14*e;
 rails.children.forEach((r,i)=>{r.material.opacity=e*(.36-i*.06);r.scale.setScalar(1+.045*Math.sin(t*.8+i));r.rotation.z=params.a*.3+Math.sin(t*.25+i)*.12;});
 halo.material.opacity=e*.13;halo.scale.set(1+e*.35*Math.sin(t*.6),1+e*.16*Math.cos(t*.5),1);
 points.material.opacity=e;
 const formed=smooth(5,Math.max(8,Math.min(17,tl.reveal??17)),t);const pc=pg.attributes.position.array;
 for(let i=0;i<N;i++){
   const u=particleData?.final[i]?.[0]??((i*71%N)/N),v=particleData?.final[i]?.[1]??((i*113%N)/N);
   const node=new THREE.Vector3((u-.5)*.17,.30-v*.23,.085+Math.sin(u*params.m*Math.PI)*.004);
   const turn=t*.18;const ox=origins[3*i]*Math.cos(turn)-origins[3*i+2]*Math.sin(turn),oz=origins[3*i]*Math.sin(turn)+origins[3*i+2]*Math.cos(turn);
   pc[3*i]=THREE.MathUtils.lerp(ox,node.x,formed);pc[3*i+1]=THREE.MathUtils.lerp(origins[3*i+1],node.y,formed);pc[3*i+2]=THREE.MathUtils.lerp(oz,node.z,formed);
 }
 pg.attributes.position.needsUpdate=true;
 assembly.updateMatrixWorld(true);
 splatMaterial.uniforms.uOpacity.value=mist*.6;splatMaterial.uniforms.uHeight.value=renderer.domElement.height;splats.visible=mist>.005;
 if(splats.visible){for(let i=0;i<owners.length;i++){
  const m=owners[i].pivot.matrixWorld.elements,x=localSamples[i*3],y=localSamples[i*3+1],z=localSamples[i*3+2],phase=splatPhases[i];
  const drift=mist*splatField[i]*.014;
  sp[i*3]=m[0]*x+m[4]*y+m[8]*z+m[12]+Math.sin(t*.8+phase)*drift;
  sp[i*3+1]=m[1]*x+m[5]*y+m[9]*z+m[13]+Math.cos(t*.65+phase)*drift;
  sp[i*3+2]=m[2]*x+m[6]*y+m[10]*z+m[14]+Math.sin(t*.9+phase)*drift;
 }sg.attributes.position.needsUpdate=true;}
 paperGeometry.setDrawRange(0,Math.floor(tl.print*rows)*cols*6);
 const yaw=.50+orbitOffset+(state.reduced?0:Math.sin(t*.17)*.11*e),distance=.76+e*.15;
 camera.position.set(Math.sin(yaw)*distance,.335+e*.04,Math.cos(yaw)*distance);camera.lookAt(target);
}
function showError(message){state.failed=true;state.running=false;$('status').textContent=message;$('status').classList.add('failed');$('start').disabled=false;$('start').textContent='用同一组输入重试 ↗';narrate(timeline(state.elapsed,{failed:true}));}
async function api(url,data){const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:undefined);const out=await r.json();if(!r.ok)throw Error(out.error||'服务暂时不可用');return out;}
async function adoptJob(job){
 state.job=job;$('sceneSerial').textContent=job.id;
 if(job.generator==='ai_imagegen')$('modeLabel').textContent='25 秒预演 · AI 阐释样张';
 particleData=await(await fetch(job.particles)).json();
 const next=await new THREE.TextureLoader().loadAsync(job.image);next.colorSpace=THREE.SRGBColorSpace;next.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 texture?.dispose();texture=next;output.material.map=texture;output.material.needsUpdate=true;
 $('download').href=job.pdf;sessionStorage.setItem('seed-press-job',job.id);
}
async function poll(jid,mode){
 try{
  const job=await api('/api/jobs/'+jid);if(state.job?.id!==jid)return;
  if(mode==='failure'&&state.elapsed>5)throw Error('验证场景：生成服务暂时不可用。真实任务与参数已经保存。');
  if(job.status==='failed')throw Error(job.error);
  if(job.status==='ready'&&!(mode==='slow'&&state.elapsed<40)&&mode!=='failure'){
    await adoptJob(job);state.readyAt=(performance.now()-startClock)/1000;
    $('status').textContent=state.mode==='rehearsal'?'作品文件已准备好 · 正在播放完整重组过程':'作品文件已准备好 · 正在收束并交付';return;
  }
  setTimeout(()=>poll(jid,mode),650);
 }catch(e){showError(e.message);}
}
function begin(){state.running=true;state.failed=false;state.elapsed=0;forcedTime=null;orbitOffset=0;startClock=performance.now();lastChapter='';document.body.classList.remove('has-result');$('result').hidden=true;$('start').disabled=true;$('start').textContent='重组正在发生';$('status').classList.remove('failed');}
async function start(){
 if(!state.loaded||state.running)return;
 if(state.job?.status==='ready'&&!state.failed){begin();state.readyAt=0;$('status').textContent='正在回放已归档作品';return;}
 state.readyAt=null;state.job=null;begin();
 try{
  state.mode=query.has('debug')?$('timing').value:state.mode;$('modeLabel').textContent=state.mode==='rehearsal'?'25 秒完整预演':state.mode==='live'?'真实生成时序':'时序验证';
  state.job=await api('/api/jobs',{...params,request_id:crypto.randomUUID()});$('sceneSerial').textContent=state.job.id;
  $('status').textContent='种子已保存 · 正在计算显影图与编号打印文件';poll(state.job.id,state.mode);
 }catch(e){showError(e.message);}
}
async function refreshPrinters(){try{const {printers}=await api('/api/printers');$('printer').replaceChildren();const none=new Option(printers.length?'选择纸张打印机':'未连接纸张打印机','');$('printer').add(none);printers.forEach(p=>$('printer').add(new Option(p,p)));$('print').disabled=!printers.length;}catch{$('print').disabled=true;}}
$('start').onclick=start;
$('motion').onclick=()=>{state.reduced=!state.reduced;$('motion').textContent=state.reduced?'恢复完整动态':'减少动态'};
$('sound').onclick=()=>{state.sound=!state.sound;$('sound').setAttribute('aria-pressed',state.sound);$('sound').textContent='声音 · '+(state.sound?'开':'关');if(state.sound)soundNote('receive');};
$('refreshPrinters').onclick=refreshPrinters;
$('timing').onchange=()=>{if(state.running)return;state.job=null;state.failed=false;state.mode=$('timing').value;$('start').textContent='开始这次重组 ↗';};
$('print').onclick=async()=>{
 if(!state.job||!$('printer').value){$('status').textContent='请先连接并选择纸张打印机';return;}
 $('print').disabled=true;
 try{const job=await api('/api/jobs/'+state.job.id+'/print',{printer:$('printer').value});state.job=job;$('status').textContent=job.print_status==='submitted'?`已交给打印队列 ${job.cups_job_id} · 请到设备确认出纸`:job.print_error||'打印状态待确认，请检查系统队列';if(job.print_status==='failed')$('print').disabled=false;}
 catch(e){$('status').textContent=e.message;$('print').disabled=false;}
};
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();showError('图形显示已中断，作品编号仍然保存；请刷新恢复')});
let lastFrame=performance.now(),frameCount=0,fpsClock=lastFrame;
function animate(now){requestAnimationFrame(animate);frameCount++;if(now-fpsClock>1000){state.fps=Math.round(frameCount*1000/(now-fpsClock));frameCount=0;fpsClock=now;}
 if(state.running)state.elapsed=forcedTime??(now-startClock)/1000;
 const tl=state.running||state.phase==='complete'?timeline(state.elapsed,{mode:state.mode,readyAt:state.readyAt,failed:state.failed}):{explosion:0,print:0,phase:'idle'};
 pose(state.elapsed,tl);renderer.render(scene,camera);
 if(state.running){narrate(tl);if(tl.complete){state.running=false;state.phase='complete';document.body.classList.add('has-result');$('result').hidden=false;$('start').disabled=false;$('start').textContent='再看一次重组 ↗';$('status').textContent='作品已生成并保存 · 等待连接纸张打印机';refreshPrinters();}}
 if(film)drawFilm(film,tl);lastFrame=now;
}
requestAnimationFrame(animate);
function drawFilm(c,tl){
 const ctx=c.getContext('2d');ctx.fillStyle='#f4eee3';ctx.fillRect(0,0,1280,720);
 const src=renderer.domElement,scale=Math.min(870/src.width,650/src.height);ctx.drawImage(src,20,35,src.width*scale,src.height*scale);
 ctx.fillStyle='#9c7771';ctx.font='12px Georgia';ctx.fillText('THE EMERGENCE / SEED PRESS',880,110);
 ctx.fillStyle='#805f60';ctx.font='40px Georgia';ctx.fillText(roman[params.m-1]+' × '+roman[params.n-1],880,175);
 const lines=copy[tl.phase]?.[1].split('<br>')||['让种子','成为作品。'];ctx.fillStyle='#665448';ctx.font='33px "Songti SC",serif';lines.forEach((v,i)=>ctx.fillText(v,880,275+i*49));
 ctx.fillStyle='#a68a78';ctx.font='13px sans-serif';ctx.fillText('规则不变，个体不同。',880,407);ctx.fillText('CHLADNI  /  '+params.m+' : '+params.n,880,443);
 ctx.strokeStyle='#d2bca9';ctx.beginPath();ctx.moveTo(70,650);ctx.lineTo(1210,650);ctx.stroke();ctx.font='12px sans-serif';ctx.fillStyle='#9b8073';ctx.fillText('01 接收     02 解构     03 显影     04 编号出纸',70,685);
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
window.experience={state,params,start,record,errors,debug:{scene,camera,renderer,pieces},seek(t){state.running=true;forcedTime=t;state.elapsed=t;startClock=performance.now()-t*1000;$('result').hidden=true;document.body.classList.remove('has-result');},resume(){forcedTime=null;startClock=performance.now()-state.elapsed*1000;},stats(){return {fps:state.fps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,meshes:pieces.length,gaussianSplats:owners.length,phase:state.phase}}};
if(query.has('job')){try{const j=await api('/api/jobs/'+query.get('job'));if(j.status==='ready'){await adoptJob(j);state.readyAt=0;state.elapsed=25;state.mode='rehearsal';state.running=true;startClock=performance.now()-25000;}}catch(e){$('status').textContent=e.message;}}
