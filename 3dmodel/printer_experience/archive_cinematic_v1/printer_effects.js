import * as THREE from 'three';
import {modulePlan,modulePose,depthCue,cameraPose} from './printer_motion.js?v=cinema-20260913';
import {PrinterCreation} from './printer_creation.js?v=cinema-20260913';
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,t)=>{const q=clamp((t-a)/(b-a));return q*q*(3-2*q)};

/** Front-on solid assembly, then depth-aware Gaussian printing. Owns only 3D presentation. */
export class FrontPrinterEffects {
 constructor(ctx){
  Object.assign(this,ctx);this.state={phase:'idle',gaussian:false};
  this.plans=this.pieces.map(p=>modulePlan(p.name,p.base));
  this.overlay=new THREE.Scene();this.overlay.add(this.splats);this.splats.visible=false;
  this.paperScene=new THREE.Scene();this.paperScene.add(this.output);
  this.floor.visible=false;this.halo.visible=false;this.points.visible=false;
  this.rails.visible=false;
  this.cosmos=new THREE.Group();this.cosmos.visible=false;
  this.installOrbitControls();
  this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:false});
  this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedShortType);
  this.focusTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false});
  this.focusTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedShortType);
  this.depthOnly=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
  this.postScene=new THREE.Scene();this.postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  this.postMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,
   uniforms:{tColor:{value:this.target.texture},tDepth:{value:this.focusTarget.depthTexture},resolution:{value:new THREE.Vector2(1,1)},cameraNear:{value:this.camera.near},cameraFar:{value:this.camera.far},focusNear:{value:.78},focusFar:{value:1.02}},
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
   fragmentShader:`uniform sampler2D tColor;uniform sampler2D tDepth;uniform vec2 resolution;uniform float cameraNear,cameraFar,focusNear,focusFar;varying vec2 vUv;
   float distanceAt(vec2 uv){float z=texture2D(tDepth,uv).x*2.-1.;return 2.*cameraNear*cameraFar/(cameraFar+cameraNear-z*(cameraFar-cameraNear));}
   void main(){float d=distanceAt(vUv);float far=smoothstep(focusNear,focusFar,d);float radius=far*5.5*resolution.y/720.;vec4 center=texture2D(tColor,vUv);vec3 sum=center.rgb*center.a;float alpha=center.a;float weight=1.;
    for(int i=0;i<12;i++){float angle=float(i)*2.399963;float r=sqrt((float(i)+.5)/12.)*radius;vec4 s=texture2D(tColor,vUv+vec2(cos(angle),sin(angle))*r/resolution);sum+=s.rgb*s.a;alpha+=s.a;weight+=1.;}
    vec3 col=alpha>.00001?sum/alpha:vec3(0.);float l=dot(col,vec3(.2126,.7152,.0722));col=mix(vec3(l),col,mix(1.18,.42,far));gl_FragColor=vec4(max(col,vec3(0.)),alpha/weight);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.postMaterial));
  this.splatMaterial.uniforms={uOpacity:{value:0},uHeight:{value:700},uViewport:{value:new THREE.Vector2(1,1)},uDepth:{value:this.target.depthTexture},uNear:{value:this.camera.near},uFar:{value:this.camera.far},uFocusNear:{value:.73},uFocusFar:{value:1.0}};
  this.splatMaterial.depthTest=false;this.splatMaterial.depthWrite=false;
  this.splatMaterial.vertexShader=`attribute float aSize,aAngle,aAspect;uniform float uHeight,uFocusNear,uFocusFar;varying vec3 vColor;varying float vAngle,vAspect,vDepth,vFar;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;vFar=smoothstep(uFocusNear,uFocusFar,vDepth);float l=dot(color,vec3(.2126,.7152,.0722));vColor=mix(vec3(l),color,mix(1.25,.36,vFar));vAngle=aAngle;vAspect=aAspect;gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*.72*uHeight*projectionMatrix[1][1]/vDepth*mix(1.,2.05,vFar),1.4,22.);}`;
  this.splatMaterial.fragmentShader=`uniform float uOpacity,uNear,uFar;uniform vec2 uViewport;uniform sampler2D uDepth;varying vec3 vColor;varying float vAngle,vAspect,vDepth,vFar;
   void main(){float z=texture2D(uDepth,gl_FragCoord.xy/uViewport).x*2.-1.;float opaqueDistance=2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear));if(vDepth>opaqueDistance+.004)discard;
    vec2 q=(gl_PointCoord-.5)*2.;float c=cos(vAngle),s=sin(vAngle);q=mat2(c,-s,s,c)*q;q.y/=vAspect;float alpha=exp(-mix(8.5,1.9,vFar)*dot(q,q))*uOpacity*mix(1.,.30,vFar);if(alpha<.009)discard;gl_FragColor=vec4(max(vColor,vec3(0.)),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`;
  this.splatMaterial.needsUpdate=true;
  // Receipt curves out of the slot and hangs in front, remaining readable from a true front view.
  const attr=this.paperGeometry.attributes.position,cols=12,rows=80,r=.018,arc=r*Math.PI/2;
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
   const u=j/rows,length=u*.216;let y,z;
   if(length<arc){const a=length/r;y=.069-r*(1-Math.cos(a));z=.083+r*Math.sin(a);}else{y=.069-r-(length-arc);z=.083+r+.014*smooth(.78,1,u);}
   attr.setXYZ(j*(cols+1)+i,(i/cols-.5)*.126,y,z);
  }
  attr.needsUpdate=true;this.paperGeometry.computeVertexNormals();
  this.output.material.depthTest=false;this.output.material.depthWrite=false;this.output.material.side=THREE.FrontSide;
  this.paperBack=new THREE.Mesh(this.paperGeometry,new THREE.MeshBasicMaterial({color:0xf1e8dc,side:THREE.BackSide,depthTest:false,depthWrite:false,toneMapped:false}));this.paperScene.add(this.paperBack);
  this.paperUniforms={paperFeed:{value:0},sceneDepth:{value:this.target.depthTexture},viewportSize:{value:new THREE.Vector2(1,1)},nearPlane:{value:this.camera.near},farPlane:{value:this.camera.far}};
  for(const material of [this.output.material,this.paperBack.material]){
   material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,this.paperUniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPaperProgress;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaperProgress=1.-uv.y;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying float vPaperProgress;uniform float paperFeed;uniform sampler2D sceneDepth;uniform vec2 viewportSize;uniform float nearPlane,farPlane;float linearPaperDepth(float d){float z=d*2.-1.;return 2.*nearPlane*farPlane/(farPlane+nearPlane-z*(farPlane-nearPlane));}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if(vPaperProgress>paperFeed)discard;\nif(linearPaperDepth(gl_FragCoord.z)>linearPaperDepth(texture2D(sceneDepth,gl_FragCoord.xy/viewportSize).r)+.002)discard;`);
   };
   material.customProgramCacheKey=()=> 'continuous-paper-v2';material.needsUpdate=true;
  }
  this.creation=new PrinterCreation({scene:this.overlay,output:this.output,params:this.params,depthUniforms:this.paperUniforms});
 }
 installOrbitControls(){
  this.orbit={yaw:0,pitch:0,radius:.85};this.autoCamera=true;const canvas=this.renderer.domElement;canvas.style.cursor='grab';canvas.style.touchAction='none';let drag=null;
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.takeCamera();drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;this.orbit.yaw-=(e.clientX-drag[0])*.006;this.orbit.pitch=Math.max(-.55,Math.min(.72,this.orbit.pitch+(e.clientY-drag[1])*.004));drag=[e.clientX,e.clientY];});
  const stop=()=>{drag=null;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
  canvas.addEventListener('wheel',e=>{e.preventDefault();this.takeCamera();this.orbit.radius=Math.max(.58,Math.min(1.35,this.orbit.radius*Math.exp(e.deltaY*.001)));},{passive:false});
  canvas.addEventListener('dblclick',()=>this.resetView());
  canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();this.takeCamera();if(e.key==='Home')this.resetView();else if(e.key==='ArrowLeft')this.orbit.yaw-=.12;else if(e.key==='ArrowRight')this.orbit.yaw+=.12;else this.orbit.pitch=Math.max(-.55,Math.min(.72,this.orbit.pitch+(e.key==='ArrowUp'?.08:-.08)));}});
 }
 takeCamera(){if(!this.autoCamera)return;const current=this.state.camera;if(current){this.orbit.yaw=current.yaw;this.orbit.pitch=current.pitch;this.orbit.radius=current.radius;}this.autoCamera=false;}
 resetView({cinematic=false}={}){this.orbit.yaw=0;this.orbit.pitch=0;this.orbit.radius=cinematic?.85:.85+.095*smooth(.58,1,this.state.print??0);this.autoCamera=cinematic;}
 setArtwork(texture,job,field){this.creation.setArtwork(texture,job,field);}
 update(time,tl,options){
  const idle=tl.phase==='idle',t=idle?0:time;
  const age=t-(tl.creationStart??Infinity),printing=!idle&&!tl.complete&&tl.phase!=='failed'&&age>=0&&options.hasArtwork;
  const print=options.hasArtwork?(tl.complete?1:tl.print??0):0;
  const active=printing&&print<1;
  const mist=active&&!options.reduced?smooth(1.6,3.1,age)*(1-smooth(.80,1,print)):0;
  this.state={idle,phase:idle?'assembled':tl.phase,gaussian:mist>.001,time:t,print,creationAge:age};
  this.assembly.rotation.set(0,0,0);this.assembly.scale.set(1,1,1);
  let locked=0;
  this.pieces.forEach((p,i)=>{
   const pose=modulePose(this.plans[i],idle?12:t,options.reduced);
   p.pivot.visible=pose.visible&&!p.name.includes('Blank input');
   p.pivot.position.set(p.base.x+pose.offset[0],p.base.y+pose.offset[1],p.base.z+pose.offset[2]);
   p.pivot.rotation.set(...pose.rotation);p.pivot.scale.set(1,1,1);
   const acrylic=p.mesh.material.name.startsWith('Acrylic');
   p.mesh.material.opacity=p.baseOpacity*pose.opacity*(acrylic?1-.10*mist:1);p.mesh.material.depthWrite=!acrylic&&pose.opacity>.98;
   p.mesh.children.forEach(child=>{if(child.isLineSegments)child.material.opacity=.24*pose.opacity;});
   if(pose.locked)locked++;
   // Rollers follow actual feed distance, so they do not snap back when printing ends.
   if(/Platen roller|White paper roll/.test(p.name))p.pivot.rotation.x-=print*18;
   const motion=p.mesh.userData.mechanicalMotion;
   if(motion?.type==='rotate')p.pivot.rotation[motion.axis]+=print*motion.speed*12;
   if(motion?.type==='cutter'){const q=smooth(.965,1,print);p.pivot.position.y-=Math.sin(q*Math.PI)*(motion.stroke??.012);}
  });
  this.state.lockedModules=locked;this.assembly.updateMatrixWorld(true);
  this.cosmos.visible=false;
  this.splats.visible=mist>.001;this.splatMaterial.uniforms.uOpacity.value=.55*mist;
  this.splatMaterial.uniforms.uHeight.value=this.renderer.domElement.height;
  // Local pigment streams instead of glitter across the entire machine.
  const colors=this.sg.attributes.color.array,count=1800;
  this.sg.setDrawRange(0,this.splats.visible?count:0);
  if(this.splats.visible){for(let i=0;i<count;i++){
   const k=i*3,source=(i*17)%this.owners.length,phase=this.splatPhases[source];
   const u=((age*.22+phase/6.283185)%1+1)%1,v=u*u*(3-2*u),side=i%2?1:-1;
   this.sp[k]=side*(.12+.025*Math.sin(phase))*(1-v)+(this.universe.uv[source*2]-.5)*.10*v;
   this.sp[k+1]=.13+.05*Math.sin(phase)*(1-v)-.061*v;
   this.sp[k+2]=.14+.035*Math.cos(phase)*(1-v)-.045*v;
   for(let d=0;d<3;d++)colors[k+d]=this.gardenColors[source*3+d];
  }this.sg.attributes.position.needsUpdate=true;this.sg.attributes.color.needsUpdate=true;}
  // Fragment clipping moves continuously between geometry rows (formerly 80 visible steps).
  this.paperGeometry.setDrawRange(0,print>0?80*12*6:0);this.paperUniforms.paperFeed.value=print;
  const shot=cameraPose(t,{print,idle,reduced:options.reduced}),orbit=this.orbit;
  const yaw=orbit.yaw+(this.autoCamera?shot.yaw:0),pitch=orbit.pitch+(this.autoCamera?shot.pitch:0);
  const radius=orbit.radius+(this.autoCamera?shot.radius-.85:0),cp=Math.cos(pitch);
  this.camera.position.set(radius*cp*Math.sin(yaw),shot.targetY+radius*Math.sin(pitch),radius*cp*Math.cos(yaw));
  this.camera.up.set(0,1,0);this.camera.lookAt(0,shot.targetY,0);
  this.camera.fov=shot.fov;this.camera.updateProjectionMatrix();
  this.postMaterial.uniforms.focusNear.value=radius-.055;this.postMaterial.uniforms.focusFar.value=radius+.20;
  this.splatMaterial.uniforms.uFocusNear.value=radius-.12;this.splatMaterial.uniforms.uFocusFar.value=radius+.15;
  this.state.camera={x:this.camera.position.x,yaw,pitch,radius,automatic:this.autoCamera&&!options.reduced};
  this.state.nearCue=depthCue(radius-.11,radius);this.state.farCue=depthCue(radius+.15,radius);
  this.creation.update(t,tl,{active,reduced:options.reduced,height:this.renderer.domElement.height});
  this.state.creation=this.creation.evidence;
  const marker=this.state.phase+':'+this.state.gaussian;
  if(marker!==this.lastMarker){
   this.lastMarker=marker;this.renderer.domElement.dataset.printerPhase=this.state.phase;
   this.renderer.domElement.dataset.gaussian=String(this.state.gaussian);
   this.onPhaseChange?.({...this.state});
  }
 }
 render(){
  const size=new THREE.Vector2();this.renderer.getDrawingBufferSize(size);
  if(this.target.width!==size.x||this.target.height!==size.y){this.target.setSize(size.x,size.y);this.focusTarget.setSize(size.x,size.y);this.postMaterial.uniforms.resolution.value.copy(size);this.splatMaterial.uniforms.uViewport.value.copy(size);this.paperUniforms.viewportSize.value.copy(size);}
  const r=this.renderer;r.autoClear=true;r.setRenderTarget(this.target);r.render(this.scene,this.camera);
  const cosmosVisible=this.cosmos.visible;this.cosmos.visible=false;this.scene.overrideMaterial=this.depthOnly;
  r.setRenderTarget(this.focusTarget);r.render(this.scene,this.camera);this.scene.overrideMaterial=null;this.cosmos.visible=cosmosVisible;
  r.setRenderTarget(null);r.render(this.postScene,this.postCamera);
  r.autoClear=false;r.clearDepth();if(this.splats.visible||this.creation.marks.visible)r.render(this.overlay,this.camera);r.render(this.paperScene,this.camera);r.autoClear=true;
 }
 drawReviewFrame(canvas){
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f4eee3';ctx.fillRect(0,0,1280,720);
  const src=this.renderer.domElement,scale=Math.min(820/src.width,640/src.height);ctx.drawImage(src,35,25,src.width*scale,src.height*scale);
  const labels={assembly:['定位 · 对齐','逐件扣合'],assembled:['结构归位','等待打印'],creating:['符号汇聚','逐笔显影'],print:['完成落笔','作品落纸'],complete:['出纸完成','机械结构预览']};
  const lines=labels[this.state.phase]||labels.assembled;
  ctx.fillStyle='#a17783';ctx.font='12px Georgia';ctx.fillText('MECHANICAL PRINTER / 3D STUDY',865,120);
  ctx.fillStyle='#6e5c57';ctx.font='34px "Songti SC",serif';lines.forEach((v,i)=>ctx.fillText(v,865,245+i*53));
  ctx.font='13px sans-serif';ctx.fillStyle='#a18a7b';ctx.fillText('拖动旋转查看 · 分层装配',865,415);ctx.fillText('打印阶段启用高斯色粒',865,445);
  ctx.font='10px monospace';ctx.fillText('25s / 3D EFFECT PREVIEW',865,560);
 }
}
