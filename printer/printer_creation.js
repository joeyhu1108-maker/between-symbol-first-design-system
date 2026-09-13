import * as THREE from 'three';
import {ease} from './printer_motion.js?v=spring-long-20260913';
const clamp=x=>Math.max(0,Math.min(1,x));
// Six open, handwritten marks: orbit, fork, crossing, broken frame, wave, trace.
// These are a visualization of the input field, not pretend AI tokens or card labels.
function glyph(ctx,kind,x,y,r,angle=0){
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.beginPath();
 if(kind===0)ctx.ellipse(0,0,r,r*.62,.25,.4,Math.PI*1.87);
 if(kind===1){ctx.moveTo(0,r);ctx.lineTo(0,-r*.2);ctx.lineTo(-r*.7,-r);ctx.moveTo(0,-r*.2);ctx.lineTo(r*.7,-r*.7);}
 if(kind===2){ctx.moveTo(-r,-r*.5);ctx.lineTo(r,r*.5);ctx.moveTo(-r*.4,r);ctx.lineTo(r*.45,-r);}
 if(kind===3){ctx.moveTo(r*.4,-r);ctx.lineTo(-r*.9,-r*.8);ctx.lineTo(-r*.8,r*.8);ctx.lineTo(r*.8,r);ctx.lineTo(r*.9,0);}
 if(kind===4){ctx.moveTo(-r,0);ctx.bezierCurveTo(-r*.5,-r*1.6,r*.25,r*1.6,r,-r*.2);}
 if(kind===5){ctx.moveTo(-r,r*.7);ctx.quadraticCurveTo(-r*.1,-r,r,-r*.6);ctx.moveTo(r*.15,-r*.4);ctx.lineTo(r*.5,r*.35);}
 ctx.stroke();ctx.restore();
}
export class PrinterCreation {
 constructor({scene,output,params,depthUniforms}){
  this.params=params;this.output=output;this.count=72;this.source=null;this.lastFrame=-1;
  const atlas=document.createElement('canvas');atlas.width=384;atlas.height=64;
  const a=atlas.getContext('2d');a.strokeStyle='#fff';a.lineWidth=2.5;a.lineCap='round';a.lineJoin='round';
  for(let i=0;i<6;i++)glyph(a,i,i*64+32,32,20);
  const texture=new THREE.CanvasTexture(atlas);
  this.positions=new Float32Array(this.count*3);this.colors=new Float32Array(this.count*3);this.strengths=new Float32Array(this.count);this.kinds=new Float32Array(this.count);
  this.geometry=new THREE.BufferGeometry();
  for(const [key,value,size] of [['position',this.positions,3],['color',this.colors,3],['strength',this.strengths,1],['kind',this.kinds,1]])this.geometry.setAttribute(key,new THREE.BufferAttribute(value,size));
  this.material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,vertexColors:true,
   uniforms:{atlas:{value:texture},height:{value:700},sceneDepth:depthUniforms.sceneDepth,viewport:depthUniforms.viewportSize,nearPlane:depthUniforms.nearPlane,farPlane:depthUniforms.farPlane},
   vertexShader:`attribute float strength,kind;uniform float height;varying float vStrength,vKind,vDepth;varying vec3 vColor;
    void main(){vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;vStrength=strength;vKind=kind;vColor=color;gl_Position=projectionMatrix*p;gl_PointSize=clamp(.017*height/max(.1,-p.z),7.,32.);}`,
   fragmentShader:`uniform sampler2D atlas,sceneDepth;uniform vec2 viewport;uniform float nearPlane,farPlane;varying float vStrength,vKind,vDepth;varying vec3 vColor;
    void main(){float z=texture2D(sceneDepth,gl_FragCoord.xy/viewport).x*2.-1.;float d=2.*nearPlane*farPlane/(farPlane+nearPlane-z*(farPlane-nearPlane));if(vDepth>d+.002)discard;
     float alpha=texture2D(atlas,vec2((vKind+gl_PointCoord.x)/6.,1.-gl_PointCoord.y)).a*vStrength;
     if(alpha<.01)discard;gl_FragColor=vec4(vColor,alpha);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`});
  this.marks=new THREE.Points(this.geometry,this.material);this.marks.frustumCulled=false;this.marks.visible=false;scene.add(this.marks);
  this.canvas=document.createElement('canvas');this.canvas.width=560;this.canvas.height=960;this.ctx=this.canvas.getContext('2d');
  this.workingTexture=new THREE.CanvasTexture(this.canvas);this.workingTexture.colorSpace=THREE.SRGBColorSpace;this.workingTexture.anisotropy=4;
 }
 setArtwork(texture,job,field){
  this.source=texture;this.job=job;this.field=field;this.lastFrame=-1;
  const small=document.createElement('canvas');small.width=56;small.height=96;const c=small.getContext('2d');c.drawImage(texture.image,0,0,56,96);
  const data=c.getImageData(0,0,56,96).data,color=new THREE.Color();
  const nodes=field.final||field.points||field.initial;
  this.samples=Array.from({length:this.count},(_,i)=>{
   const uv=nodes[(i*61+this.params.seed)%nodes.length],x=clamp(uv[0]),y=clamp(uv[1]);
   const k=(Math.floor(y*95)*56+Math.floor(x*55))*4;
   color.setRGB(data[k]/255,data[k+1]/255,data[k+2]/255,THREE.SRGBColorSpace).lerp(new THREE.Color(i%2?0x936a83:0xb16676),.74);
   color.toArray(this.colors,i*3);this.kinds[i]=(i+this.params.m+this.params.n)%6;return [x,y];
  });
  this.geometry.attributes.color.needsUpdate=true;this.geometry.attributes.kind.needsUpdate=true;
 }
 update(time,tl,{active,reduced,height}){
  const feed=clamp(tl.print||0),age=time-(tl.creationStart??Infinity);
  this.marks.visible=active&&!reduced&&!!this.source&&feed<.97;
  this.material.uniforms.height.value=height;
  const intensity=ease(age/1.1)*(1-ease((feed-.78)/.19));
  if(this.marks.visible){
   for(let i=0;i<this.count;i++){
    const [x,y]=this.samples[i],phase=((age*.18+i*.61803398875)%1+1)%1,converge=ease(phase),angle=x*Math.PI*2+phase*.8+this.params.a*.4;
    const side=i%2?1:-1,spread=(1-converge);
    this.positions[i*3]=side*(.13+x*.035)*spread+Math.sin(angle)*.025*spread+(x-.5)*.105*converge;
    this.positions[i*3+1]=.11+(.07+y*.075)*spread-.041*converge;
    this.positions[i*3+2]=.12+Math.cos(angle)*.025*spread-.025*converge;
    this.strengths[i]=intensity*ease(phase/.15)*(1-ease((phase-.83)/.17))*.82;
   }
   this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.strength.needsUpdate=true;
  }
  if(!this.source)return;
  if(feed>=1||tl.complete){if(this.output.material.map!==this.source){this.output.material.map=this.source;this.output.material.needsUpdate=true;}return;}
  const frame=Math.floor(time*24);if(frame===this.lastFrame)return;this.lastFrame=frame;
  const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
  ctx.clearRect(0,0,w,h);ctx.drawImage(this.source.image,0,0,w,h);
  // The newest paper band briefly carries the grammar of the field, then resolves
  // to the exact archived raster. Completed regions never flicker or repaint.
  if(feed>0&&!reduced){
   const frontier=feed*h,band=45,fade=ctx.createLinearGradient(0,frontier-band,0,frontier+8);
   fade.addColorStop(0,'rgba(249,243,234,0)');fade.addColorStop(1,'rgba(249,243,234,.95)');
   ctx.fillStyle=fade;ctx.fillRect(0,Math.max(0,frontier-band),w,band+9);
   ctx.strokeStyle='rgba(155,91,119,.68)';ctx.lineWidth=1.4;ctx.lineCap='round';
   for(let i=0;i<11;i++){const x=(i+.5)*w/11+Math.sin(i*2.3+this.params.seed)*9;glyph(ctx,(i+this.params.m)%6,x,frontier-10+Math.sin(i)*7,5,Math.sin(i+time*.5)*.35);}
  }
  this.workingTexture.needsUpdate=true;
  if(this.output.material.map!==this.workingTexture){this.output.material.map=this.workingTexture;this.output.material.needsUpdate=true;}
 }
 get evidence(){return {jobId:this.job?.id,image:this.job?.image,source:this.job?.generator,seed:this.params.seed,symbols:this.marks.visible?this.count:0,exactFinalTexture:this.output.material.map===this.source};}
}
