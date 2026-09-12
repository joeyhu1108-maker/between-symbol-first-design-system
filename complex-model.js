import * as THREE from './vendor/three.module.min.js';

const host=document.querySelector('#experience');
const canvas=document.createElement('canvas'); canvas.id='model3d'; host.insertBefore(canvas,host.querySelector('#universe'));
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.setClearColor(0,0);
const scene=new THREE.Scene();
// Pull back enough to keep the complete cabinet (including the plinth) in frame.
const camera=new THREE.PerspectiveCamera(34,1,.1,100); camera.position.set(0,.1,8.1);
scene.add(new THREE.AmbientLight(0x6a8ca8,1.1));
const key=new THREE.PointLight(0xff7e68,2.2,12); key.position.set(-2,1.8,3); scene.add(key);
const fill=new THREE.PointLight(0x75cfff,2,10); fill.position.set(2,-1,2); scene.add(fill);
const root=new THREE.Group(); scene.add(root);

// Physical exhibition case: one lavender frame, transparent glass planes and a plinth.
// It stays static while the seed inside rotates and responds to nutrients.
const caseGroup=new THREE.Group(); scene.add(caseGroup);
// Three-quarter orientation reveals the front and side glass planes like the physical reference.
caseGroup.rotation.y=-.18;
const frameMat=new THREE.MeshBasicMaterial({color:0xb68cff,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false});
const glassMat=new THREE.MeshBasicMaterial({color:0xd8caff,transparent:true,opacity:.055,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
const caseInnerW=3.72, caseInnerH=4.08, caseDepth=2.72, frame=.18;
function caseBar(w,h,d,x,y,z,material=frameMat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);caseGroup.add(m);return m;}
// four upright corner posts
for(const x of [-2.02,2.02])for(const z of [-1.48,1.48])caseBar(frame,caseInnerH+frame*2,frame,x,0,z);
// top and bottom rails, front and back
for(const y of [-2.14,2.14])for(const z of [-1.48,1.48])caseBar(caseInnerW+frame*2,frame,frame,0,y,z);
// depth rails emphasize the cabinet's cubic volume
for(const x of [-2.02,2.02])for(const y of [-2.14,2.14])caseBar(frame,frame,caseDepth+frame*2,x,y,0);
// subtle inner glass surfaces
const frontGlass=new THREE.Mesh(new THREE.PlaneGeometry(caseInnerW,caseInnerH),glassMat);frontGlass.position.z=1.39;caseGroup.add(frontGlass);
const backGlass=new THREE.Mesh(new THREE.PlaneGeometry(caseInnerW,caseInnerH),glassMat.clone());backGlass.position.z=-1.39;backGlass.rotation.y=Math.PI;caseGroup.add(backGlass);
const sideGlassL=new THREE.Mesh(new THREE.PlaneGeometry(caseDepth,caseInnerH),glassMat.clone());sideGlassL.position.x=-1.93;sideGlassL.rotation.y=Math.PI/2;caseGroup.add(sideGlassL);
const sideGlassR=new THREE.Mesh(new THREE.PlaneGeometry(caseDepth,caseInnerH),glassMat.clone());sideGlassR.position.x=1.93;sideGlassR.rotation.y=-Math.PI/2;caseGroup.add(sideGlassR);
// stepped plinth, echoing the physical reference object
caseBar(4.42,.28,3.36,0,-2.36,0);
caseBar(4.05,.18,3.02,0,-2.16,0);

// Rough split meteor/seed body: a tactile low-poly mass behind the luminous membrane.
function roughChunk(color,x){
  const g=new THREE.IcosahedronGeometry(.92,2), p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const vx=p.getX(i),vy=p.getY(i),vz=p.getZ(i);
    const n=1+Math.sin(i*12.73+vx*3.1)*.095+Math.cos(i*7.19+vy*4.2)*.06;
    p.setXYZ(i,vx*n,vy*n,vz*n);
  }
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.58,side:THREE.DoubleSide,depthWrite:false}));
  m.scale.set(.72,1.22,.62);m.position.set(x,.02,-.05);root.add(m);return m;
}
const rockL=roughChunk(0xb86cf2,-.48),rockR=roughChunk(0xff8fcb,.48);

function shellGeometry(start,end){
  const rows=32, cols=26, pos=[], idx=[];
  for(let y=0;y<=rows;y++){
    const v=y/rows, yy=(v-.5)*3.25, rr=Math.pow(Math.sin(Math.PI*v),.62);
    for(let x=0;x<=cols;x++){
      const u=start+(end-start)*x/cols, n=.95+Math.sin(u*5.1+v*8.3)*.035+Math.sin(v*19)*.018;
      pos.push(Math.cos(u)*rr*n*1.18,yy,Math.sin(u)*rr*n*.72);
    }
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;idx.push(a,b,d,a,d,c)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
// Unlit additive membrane stays luminous on a black exhibition wall (no env-map required).
const shellMat=new THREE.MeshBasicMaterial({color:0x3abbe6,transparent:true,opacity:.12,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
const left=new THREE.Mesh(shellGeometry(-Math.PI,-.035),shellMat); const right=new THREE.Mesh(shellGeometry(.035,Math.PI),shellMat.clone()); root.add(left,right);
// A low-opacity wire shell makes the membrane read as a volume rather than a flat cutout.
const wireMat=new THREE.MeshBasicMaterial({color:0x86ddff,transparent:true,opacity:.22,wireframe:true,blending:THREE.AdditiveBlending,depthWrite:false});
const leftWire=new THREE.Mesh(left.geometry.clone(),wireMat); const rightWire=new THREE.Mesh(right.geometry.clone(),wireMat.clone());
leftWire.scale.setScalar(1.008); rightWire.scale.setScalar(1.008); root.add(leftWire,rightWire);
// Crisp silhouette edges turn the translucent membrane into a clearly readable 3D object.
const edgeMatL=new THREE.LineBasicMaterial({color:0x9ce9ff,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false});
const edgeMatR=new THREE.LineBasicMaterial({color:0xffa2d0,transparent:true,opacity:.62,blending:THREE.AdditiveBlending,depthWrite:false});
const leftEdge=new THREE.LineSegments(new THREE.EdgesGeometry(left.geometry,28),edgeMatL);
const rightEdge=new THREE.LineSegments(new THREE.EdgesGeometry(right.geometry,28),edgeMatR);
leftEdge.scale.setScalar(1.014); rightEdge.scale.setScalar(1.014); root.add(leftEdge,rightEdge);
// The inner shell is slightly darker and smaller, suggesting a hollow seed cavity.
const innerMat=new THREE.MeshBasicMaterial({color:0x278bb1,transparent:true,opacity:.28,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
const leftInner=new THREE.Mesh(left.geometry.clone(),innerMat); const rightInner=new THREE.Mesh(right.geometry.clone(),innerMat.clone());
leftInner.scale.setScalar(.965); rightInner.scale.setScalar(.965); root.add(leftInner,rightInner);
const coreMat=new THREE.MeshBasicMaterial({color:0xff5f58}); const core=new THREE.Mesh(new THREE.SphereGeometry(.22,32,20),coreMat); root.add(core);
const halo=new THREE.Mesh(new THREE.SphereGeometry(.42,24,16),new THREE.MeshBasicMaterial({color:0xff5b62,transparent:true,opacity:.13,blending:THREE.AdditiveBlending}));root.add(halo);

function tube(points,color,r=.018){const curve=new THREE.CatmullRomCurve3(points);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,48, r,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false}));root.add(mesh);return mesh;}
const veins=[];
for(let i=0;i<14;i++){const a=i/14*Math.PI*2; const pts=[];for(let j=0;j<12;j++){const q=j/11,rad=.18+q*(.9+((i%3)*.08));pts.push(new THREE.Vector3(Math.cos(a+q*.55)*rad,Math.sin(q*Math.PI)*.16+(.5-q)*.1,Math.sin(a+q*.55)*rad*.55));}veins.push(tube(pts,i%3?0x7bd8ff:0xff8abb,.012));}
const dustGeo=new THREE.BufferGeometry(), dust=[];for(let i=0;i<620;i++){const a=Math.random()*Math.PI*2,r=.7+Math.random()*2.1;dust.push(Math.cos(a)*r, (Math.random()-.5)*1.6, Math.sin(a)*r*.45);}dustGeo.setAttribute('position',new THREE.Float32BufferAttribute(dust,3));const dustMat=new THREE.PointsMaterial({color:0x93dfff,size:.022,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false});const dustPts=new THREE.Points(dustGeo,dustMat);root.add(dustPts);
const nodes=[];const nodeGeo=new THREE.SphereGeometry(.035,10,8);for(let i=0;i<12;i++){const a=i/12*Math.PI*2,n=new THREE.Mesh(nodeGeo,new THREE.MeshBasicMaterial({color:i%2?0x7bd8ff:0xff8abb,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false}));n.position.set(Math.cos(a)*1.05,Math.sin(a*2.2)*.38,Math.sin(a)*.52);root.add(n);nodes.push(n)}
const rings=[];for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.72+i*.22,.008,6,96),new THREE.MeshBasicMaterial({color:i===1?0xff8abb:0x7bd8ff,transparent:true,opacity:.36,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false}));ring.rotation.x=Math.PI/2.7+i*.18;ring.scale.y=.56;ring.scale.z=.7;root.add(ring);rings.push(ring)}
// An equatorial contour gives the eye a stable depth cue as the seed turns.
const equator=new THREE.Mesh(new THREE.TorusGeometry(1.15,.012,8,128),new THREE.MeshBasicMaterial({color:0xff9fbe,transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false}));equator.rotation.x=Math.PI/2;root.add(equator);

function resize(){const r=host.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();const s=Math.min(r.width,r.height)/1250;root.scale.setScalar(s);caseGroup.scale.setScalar(s)}addEventListener('resize',resize);resize();
let last=performance.now();
let impulse=0;addEventListener('nutrient',()=>{impulse=1});
addEventListener('seed-release',()=>{impulse=1.8});
function tick(now){const dt=(now-last)/1000;last=now;const e=window.__seedEnergy??.08,g=Math.max(0,Math.min(1,(e-.08)/.92)),released=window.__seedReleased??0;const p=window.__seedPointer||{x:.5,y:.5};impulse*=.91;
  const open=.018+g*.28+released*.12; left.position.x=-open;right.position.x=open;left.rotation.z=Math.sin(now*.0007)*.01;right.rotation.z=-Math.sin(now*.0007)*.01;
  leftWire.position.x=-open;rightWire.position.x=open;leftEdge.position.x=-open;rightEdge.position.x=open;leftInner.position.x=-open*.94;rightInner.position.x=open*.94;
  root.rotation.y+=dt*.14+(p.x-.5)*.0008+impulse*.004;root.rotation.x+=((p.y-.5)*-.0005-root.rotation.x)*.03;root.rotation.z=Math.sin(now*.00023)*.018;
  camera.position.x+=((p.x-.5)*.82-camera.position.x)*.025;camera.position.y+=((p.y-.5)*-.48+.1-camera.position.y)*.025;camera.lookAt(0,0,0);
  wireMat.opacity=.24+g*.22;leftWire.material.opacity=wireMat.opacity;rightWire.material.opacity=wireMat.opacity;leftEdge.material.opacity=.62+g*.2;rightEdge.material.opacity=.54+g*.2;leftInner.material.opacity=.16+g*.16;rightInner.material.opacity=.16+g*.16;
  equator.rotation.z=now*.00018;equator.scale.setScalar(1+g*.2);
  core.scale.setScalar(1+g*.8+Math.sin(now*.004)*.06+impulse*.5);halo.scale.setScalar(1+g*1.8+impulse*.9);halo.material.opacity=.1+g*.2+impulse*.12;
  rockL.rotation.y=now*.00012;rockR.rotation.y=-now*.00016;rockL.scale.y=1.22+g*.12;rockR.scale.y=1.22+g*.12;rockL.material.opacity=.42+g*.28;rockR.material.opacity=.42+g*.28;
  veins.forEach((v,i)=>{v.scale.setScalar(.5+g*.95);v.material.opacity=.24+g*.65;v.rotation.z=now*.00012*(i%2?-1:1)});nodes.forEach((n,i)=>{const a=i/12*Math.PI*2+now*.00022*(i%2?-1:1);n.position.x=Math.cos(a)*(1.05+g*.22);n.position.z=Math.sin(a)*(.52+g*.18);n.scale.setScalar(.7+g*1.5)});rings.forEach((ring,i)=>{ring.rotation.z=now*.00015*(i%2?-1:1);ring.material.opacity=.24+g*.34});dustPts.rotation.y+=dt*(.08+g*.4);dustMat.opacity=.28+g*.5;
  renderer.render(scene,camera);requestAnimationFrame(tick)}requestAnimationFrame(tick);
