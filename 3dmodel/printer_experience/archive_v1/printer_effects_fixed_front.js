import * as THREE from 'three';
import {modulePlan,modulePose,depthCue} from './printer_motion.js';
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
  // Ordinary crisp point field at the beginning; no Gaussian material is used for this field.
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.BufferAttribute(this.universe.positions.slice(),3));cg.setAttribute('color',new THREE.BufferAttribute(this.universe.colors.slice(),3));
  const cm=new THREE.ShaderMaterial({vertexColors:true,transparent:true,depthWrite:false,uniforms:{opacity:{value:1},height:{value:700}},
   vertexShader:`uniform float height;varying vec3 c;void main(){c=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(.0012*height*projectionMatrix[1][1]/-p.z,1.,3.);}`,
   fragmentShader:`uniform float opacity;varying vec3 c;void main(){vec2 p=gl_PointCoord-.5;if(dot(p,p)>.24)discard;gl_FragColor=vec4(c,opacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
  this.cosmos=new THREE.Points(cg,cm);this.cosmos.position.y=.10;this.scene.add(this.cosmos);
  this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:false});
  this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedShortType);
  this.focusTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false});
  this.focusTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedShortType);
  this.depthOnly=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
  this.postScene=new THREE.Scene();this.postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  this.postMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,
   uniforms:{tColor:{value:this.target.texture},tDepth:{value:this.focusTarget.depthTexture},resolution:{value:new THREE.Vector2(1,1)},cameraNear:{value:this.camera.near},cameraFar:{value:this.camera.far}},
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
   fragmentShader:`uniform sampler2D tColor;uniform sampler2D tDepth;uniform vec2 resolution;uniform float cameraNear,cameraFar;varying vec2 vUv;
   float distanceAt(vec2 uv){float z=texture2D(tDepth,uv).x*2.-1.;return 2.*cameraNear*cameraFar/(cameraFar+cameraNear-z*(cameraFar-cameraNear));}
   void main(){float d=distanceAt(vUv);float far=smoothstep(.88,1.12,d);float radius=far*5.5*resolution.y/720.;vec4 center=texture2D(tColor,vUv);vec3 sum=center.rgb*center.a;float alpha=center.a;float weight=1.;
    for(int i=0;i<12;i++){float angle=float(i)*2.399963;float r=sqrt((float(i)+.5)/12.)*radius;vec4 s=texture2D(tColor,vUv+vec2(cos(angle),sin(angle))*r/resolution);sum+=s.rgb*s.a;alpha+=s.a;weight+=1.;}
    vec3 col=alpha>.00001?sum/alpha:vec3(0.);float l=dot(col,vec3(.2126,.7152,.0722));col=mix(vec3(l),col,mix(1.18,.42,far));gl_FragColor=vec4(max(col,vec3(0.)),alpha/weight);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.postMaterial));
  this.splatMaterial.uniforms={uOpacity:{value:0},uHeight:{value:700},uViewport:{value:new THREE.Vector2(1,1)},uDepth:{value:this.target.depthTexture},uNear:{value:this.camera.near},uFar:{value:this.camera.far}};
  this.splatMaterial.depthTest=false;this.splatMaterial.depthWrite=false;
  this.splatMaterial.vertexShader=`attribute float aSize,aAngle,aAspect;uniform float uHeight;varying vec3 vColor;varying float vAngle,vAspect,vDepth,vFar;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;vFar=smoothstep(.83,1.10,vDepth);float l=dot(color,vec3(.2126,.7152,.0722));vColor=mix(vec3(l),color,mix(1.25,.36,vFar));vAngle=aAngle;vAspect=aAspect;gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*.72*uHeight*projectionMatrix[1][1]/vDepth*mix(1.,2.05,vFar),1.4,22.);}`;
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
  this.output.material.depthTest=false;this.output.material.depthWrite=false;
 }
 update(time,tl,options){
  const idle=tl.phase==='idle',t=idle?0:time;
  const active=!idle&&!tl.complete&&t>=14&&options.hasArtwork;
  const mist=active?smooth(14,15.4,t)*(1-smooth(23.0,24.5,t)):0;
  this.state={phase:idle||t<5.6?'particles':t<12?'assembly':active?'printing':tl.complete?'complete':'assembled',gaussian:mist>0,time:t};
  this.assembly.rotation.set(0,0,0);this.assembly.scale.set(1,1,1);
  let locked=0;
  this.pieces.forEach((p,i)=>{
   const pose=modulePose(this.plans[i],t,options.reduced);p.pivot.visible=!idle&&pose.visible&&!p.name.includes('Blank input');
   p.pivot.position.copy(p.base).add(new THREE.Vector3(...pose.offset));p.pivot.rotation.set(...pose.rotation);p.pivot.scale.set(1,1,1);
   const acrylic=p.mesh.material.name.startsWith('Acrylic');
   p.mesh.material.opacity=p.baseOpacity*(acrylic?1-.22*mist:1);p.mesh.material.depthWrite=!acrylic;
   if(pose.locked)locked++;
   if(active&&/Platen rubber roller|Idler transport|Paper supply roll/.test(p.name))p.pivot.rotation.x=(t-14)*3.2;
   if(active&&/Thermal printhead housing/.test(p.name))p.pivot.position.x+=Math.sin(t*26)*.0012;
  });
  this.state.lockedModules=locked;this.assembly.updateMatrixWorld(true);
  this.cosmos.visible=idle||t<6.9;this.cosmos.material.uniforms.opacity.value=idle?.85:.85*(1-smooth(5.0,6.9,t));
  this.cosmos.material.uniforms.height.value=this.renderer.domElement.height;
  this.cosmos.rotation.set(options.reduced?0:.2,options.reduced?0:options.clock*.19,0);
  this.cosmos.geometry.setDrawRange(0,Math.floor(this.owners.length*(options.density??.7)));
  this.splats.visible=mist>.001;this.splatMaterial.uniforms.uOpacity.value=.9*mist;
  this.splatMaterial.uniforms.uHeight.value=this.renderer.domElement.height;
  const colors=this.sg.attributes.color.array;
  this.sg.setDrawRange(0,this.owners.length);
  if(this.splats.visible)for(let i=0;i<this.owners.length;i++){
   const k=i*3,p=this.owners[i],m=p.pivot.matrixWorld.elements,x=this.localSamples[k],y=this.localSamples[k+1],z=this.localSamples[k+2],phase=this.splatPhases[i];
   if(i%5===0){
    const u=((t-14)*.27+phase/6.283185)%1,v=u*u*(3-2*u),r=(1-v)*.068+.015;
    this.sp[k]=Math.cos(phase+u*6.283)*r+(this.universe.uv[i*2]-.5)*.012;
    this.sp[k+1]=.104+Math.sin(phase*1.3+u*3.1415)*.025*(1-v)+(this.universe.uv[i*2+1]-.5)*.009;
    this.sp[k+2]=.225-.265*v+Math.sin(i*.618)*.007;
    colors[k]=this.gardenColors[k];colors[k+1]=this.gardenColors[k+1];colors[k+2]=this.gardenColors[k+2];
   }else{
    const vibration=options.reduced?0:.0009*Math.sin(t*7+phase);
    this.sp[k]=m[0]*x+m[4]*y+m[8]*z+m[12]+vibration;
    this.sp[k+1]=m[1]*x+m[5]*y+m[9]*z+m[13];this.sp[k+2]=m[2]*x+m[6]*y+m[10]*z+m[14];
    for(let d=0;d<3;d++)colors[k+d]=this.modelColors[k+d]*.75+this.gardenColors[k+d]*.25;
   }
  }
  this.sg.attributes.position.needsUpdate=true;this.sg.attributes.color.needsUpdate=true;
  const lead=active?.14*smooth(14,17,t):0,print=options.hasArtwork?(tl.complete?1:Math.max(lead,(tl.print??0)>0?.14+.86*tl.print:0)):0;
  this.paperGeometry.setDrawRange(0,Math.floor(print*80)*12*6);
  this.camera.position.set(0,.053,.95);this.camera.up.set(0,1,0);this.camera.lookAt(0,.053,0);
  this.camera.fov=idle?36:36-9*smooth(5.6,8,t)+4*smooth(20,24,t);this.camera.updateProjectionMatrix();
  this.state.camera={x:this.camera.position.x,yaw:this.camera.rotation.y,pitch:this.camera.rotation.x};
  this.state.nearCue=depthCue(.84);this.state.farCue=depthCue(1.10);
  const marker=this.state.phase+':'+this.state.gaussian;
  if(marker!==this.lastMarker){
   this.lastMarker=marker;this.renderer.domElement.dataset.printerPhase=this.state.phase;
   this.renderer.domElement.dataset.gaussian=String(this.state.gaussian);
   this.onPhaseChange?.({...this.state});
  }
 }
 render(){
  if(this.state.phase==='particles'){this.renderer.setRenderTarget(null);this.renderer.autoClear=true;this.renderer.render(this.scene,this.camera);return;}
  const size=new THREE.Vector2();this.renderer.getDrawingBufferSize(size);
  if(this.target.width!==size.x||this.target.height!==size.y){this.target.setSize(size.x,size.y);this.focusTarget.setSize(size.x,size.y);this.postMaterial.uniforms.resolution.value.copy(size);this.splatMaterial.uniforms.uViewport.value.copy(size);}
  const r=this.renderer;r.autoClear=true;r.setRenderTarget(this.target);r.render(this.scene,this.camera);
  const cosmosVisible=this.cosmos.visible;this.cosmos.visible=false;this.scene.overrideMaterial=this.depthOnly;
  r.setRenderTarget(this.focusTarget);r.render(this.scene,this.camera);this.scene.overrideMaterial=null;this.cosmos.visible=cosmosVisible;
  r.setRenderTarget(null);r.render(this.postScene,this.postCamera);
  r.autoClear=false;r.clearDepth();if(this.splats.visible)r.render(this.overlay,this.camera);r.render(this.paperScene,this.camera);r.autoClear=true;
 }
 drawReviewFrame(canvas){
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f4eee3';ctx.fillRect(0,0,1280,720);
  const src=this.renderer.domElement,scale=Math.min(820/src.width,640/src.height);ctx.drawImage(src,35,25,src.width*scale,src.height*scale);
  const labels={particles:['准备进入','组装序列'],assembly:['定位 · 对齐','逐件扣合'],assembled:['结构归位','等待打印'],printing:['正在打印','近实 · 远虚'],complete:['出纸完成','正面效果预览']};
  const lines=labels[this.state.phase]||labels.assembled;
  ctx.fillStyle='#a17783';ctx.font='12px Georgia';ctx.fillText('FRONT ASSEMBLY / PRINTER STUDY',865,120);
  ctx.fillStyle='#6e5c57';ctx.font='34px "Songti SC",serif';lines.forEach((v,i)=>ctx.fillText(v,865,245+i*53));
  ctx.font='13px sans-serif';ctx.fillStyle='#a18a7b';ctx.fillText('固定正面镜头 · 分层装配',865,415);ctx.fillText('打印阶段启用高斯色粒',865,445);
  ctx.font='10px monospace';ctx.fillText('25s / 3D EFFECT PREVIEW',865,560);
 }
}
