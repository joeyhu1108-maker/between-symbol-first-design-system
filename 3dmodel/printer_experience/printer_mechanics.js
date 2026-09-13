import * as THREE from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

/** Mechanism-level visual construction, in metres. Inspired by real feed/head/cutter assemblies. */
export function addPrinterMechanics(root){
 const mats={
  steel:new THREE.MeshStandardMaterial({name:'Mechanics | satin aluminium',color:0x899399,metalness:.86,roughness:.3}),
  bright:new THREE.MeshStandardMaterial({name:'Mechanics | machined steel',color:0xc6c7c2,metalness:.86,roughness:.23}),
  brass:new THREE.MeshStandardMaterial({name:'Mechanics | brass bearings',color:0xb29772,metalness:.77,roughness:.35}),
  dark:new THREE.MeshStandardMaterial({name:'Mechanics | graphite drive rubber',color:0x39343b,roughness:.72}),
  rose:new THREE.MeshStandardMaterial({name:'Mechanics | dusty rose insulator',color:0xb78d9c,roughness:.45}),
  cream:new THREE.MeshStandardMaterial({name:'Mechanics | ceramic roller',color:0xdcd2c0,roughness:.38}),
  copper:new THREE.MeshStandardMaterial({name:'Mechanics | flexible circuit',color:0xc39670,metalness:.35,roughness:.5})
 };
 const batches=new Map();let components=0;
 function emit(name,g,mat,position=[0,0,0],rotation=[0,0,0],motion=null){
  const m=new THREE.Mesh(g,mat);m.position.set(...position);m.rotation.set(...rotation);m.updateMatrix();components++;
  if(motion){m.name=name;m.userData.mechanicalMotion=motion;root.add(m);return m;}
  g.applyMatrix4(m.matrix);if(g.index)g=g.toNonIndexed();
  for(const attr of Object.keys(g.attributes))if(!['position','normal','uv'].includes(attr))g.deleteAttribute(attr);
  if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  const key=name+'|'+mat.name;if(!batches.has(key))batches.set(key,{name,mat,geometries:[]});batches.get(key).geometries.push(g);return m;
 }
 const box=(name,p,d,mat)=>emit(name,new THREE.BoxGeometry(...d),mat,p);
 function cylinder(name,p,r,length,mat,axis='x',motion=null){return emit(name,new THREE.CylinderGeometry(r,r,length,48),mat,p,axis==='x'?[0,0,Math.PI/2]:axis==='z'?[Math.PI/2,0,0]:[0,0,0],motion);}
 function ring(name,p,r,t,mat,axis='x'){emit(name,new THREE.TorusGeometry(r,t,6,48),mat,p,axis==='x'?[0,Math.PI/2,0]:axis==='y'?[Math.PI/2,0,0]:[0,0,0]);}
 function tube(name,points,r,mat){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));emit(name,new THREE.TubeGeometry(curve,48,r,6,false),mat);}
 function screw(name,p,axis='x'){
  cylinder(name,p,.0017,.001,mats.brass,axis);
  const q=[...p];q[axis==='x'?0:axis==='y'?1:2]+=.00053;
  box(name,q,axis==='x'?[.00016,.0019,.00035]:axis==='y'?[.0019,.00016,.00035]:[.0019,.00035,.00016],mats.dark);
 }
 function gear(name,p,r,teeth,speed){
  const s=new THREE.Shape(),count=teeth*4;
  for(let i=0;i<count;i++){const a=i/count*Math.PI*2,rad=(i%4===1||i%4===2)?r:r-.001;const x=Math.cos(a)*rad,y=Math.sin(a)*rad;i?s.lineTo(x,y):s.moveTo(x,y);}s.closePath();
  const hole=new THREE.Path();hole.absarc(0,0,.0018,0,Math.PI*2,true);s.holes.push(hole);
  if(r>.006)for(let i=0;i<3;i++){const a=i/3*Math.PI*2,h=new THREE.Path();h.absarc(Math.cos(a)*r*.47,Math.sin(a)*r*.47,r*.17,0,Math.PI*2,true);s.holes.push(h);}
  const g=new THREE.ExtrudeGeometry(s,{depth:.0022,bevelEnabled:true,bevelThickness:.00014,bevelSize:.00014,bevelSegments:1,curveSegments:16});g.translate(0,0,-.0011);
  return emit(name,g,mats.bright,p,[0,Math.PI/2,0],{type:'rotate',axis:'x',speed});
 }
 // Side plate is relieved with real openings, leaving a readable mechanical chassis.
 const plate=new THREE.Shape();plate.moveTo(-.038,-.032);plate.lineTo(.043,-.032);plate.lineTo(.043,.036);plate.lineTo(-.038,.036);plate.closePath();
 for(const [x,y,r] of [[-.014,0,.013],[.020,.013,.014]]){const h=new THREE.Path();h.absarc(x,y,r,0,Math.PI*2,true);plate.holes.push(h);}
 const plateG=new THREE.ExtrudeGeometry(plate,{depth:.002,bevelEnabled:true,bevelSize:.0003,bevelThickness:.0003,bevelSegments:2});
 emit('Mechanism Motor mounting plate',plateG,mats.steel,[-.096,.076,.028],[0,Math.PI/2,Math.PI/2]);
 for(const y of [.042,.112])for(const z of [.002,.055])screw('Mechanism Motor frame fasteners',[-.108,y,z]);
 cylinder('Mechanism Motor cutter drive',[-.09,.050,.005],.009,.025,mats.steel);
 cylinder('Mechanism Motor end cap',[-.0765,.050,.005],.0093,.002,mats.dark);
 cylinder('Mechanism Motor output spindle',[-.097,.050,.005],.002,.028,mats.bright);
 gear('Mechanism cutter gear pinion',[-.107,.050,.005],.004,14,9.0);
 gear('Mechanism cutter gear reduction',[-.107,.0618,.005],.009,28,-4.5);
 gear('Mechanism cutter gear idler',[-.107,.0758,.005],.0065,20,6.3);
 for(const [y,z] of [[.05,.005],[.0618,.005],[.0758,.005]]){ring('Mechanism Motor thrust washers',[-.109,y,z],.0026,.00045,mats.brass);cylinder('Mechanism Motor bearing axle',[-.099,y,z],.0018,.020,mats.bright);}
 // Equal-diameter pulleys, a closed toothed belt and a front cutter cam.
 const c1=[.0758,.005],c2=[.103,.062],rad=.009,dy=c2[0]-c1[0],dz=c2[1]-c1[1],angle=Math.atan2(dz,dy);
 for(const [y,z] of [c1,c2]){
  gear('Mechanism belt pulley',[-.102,y,z],rad,28,6.3);
  ring('Mechanism belt flanges',[-.104,y,z],.0094,.0005,mats.brass);
  cylinder('Mechanism belt shaft',[-.092,y,z],.0023,.028,mats.bright);
 }
 const belt=[];
 for(let i=0;i<=36;i++){const a=angle-Math.PI/2-i/36*Math.PI;belt.push([-.102,c1[0]+Math.cos(a)*rad,c1[1]+Math.sin(a)*rad]);}
 for(let i=0;i<=36;i++){const a=angle+Math.PI/2-i/36*Math.PI;belt.push([-.102,c2[0]+Math.cos(a)*rad,c2[1]+Math.sin(a)*rad]);}
 belt.push(belt[0]);tube('Mechanism timing belt loop',belt,.0010,mats.dark);
 for(let i=0;i<34;i++){const t=i/33,y=c1[0]+dy*t,z=c1[1]+dz*t;const ny=-Math.sin(angle),nz=Math.cos(angle);for(const side of [-1,1])box('Mechanism timing belt teeth',[-.102,y+side*ny*rad,z+side*nz*rad],[.003,.0008,.0008],mats.dark);}
 gear('Mechanism eccentric cutter cam',[-.0815,.103,.062],.0085,30,6.3);
 cylinder('Mechanism cam follower',[-.080,.093,.069],.0028,.005,mats.cream);
 // Auto-cutter blade, twin guide rails and spring-loaded sliding blocks.
 const blade=emit('Mechanism moving cutting blade',new THREE.BoxGeometry(.171,.010,.0018),mats.bright,[0,.086,.075],[0,0,0],{type:'cutter',stroke:.012});
 for(const x of [-.087,.087]){
  cylinder('Mechanism cutter guide rail',[x,.089,.073],.0018,.031,mats.bright,'y');
  box('Mechanism cutter rail support',[x,.106,.073],[.012,.005,.011],mats.steel);
  box('Mechanism cutter lower guide',[x,.074,.073],[.011,.005,.012],mats.steel);
  emit('Mechanism cutter sliding block',new THREE.BoxGeometry(.010,.009,.008),mats.cream,[x,.087,.071],[0,0,0],{type:'cutter',stroke:.012});
  screw('Mechanism cutter fasteners',[x,.106,.080],'z');
 }
 // Spring-loaded head pressure bridge and hinge arms.
 box('Mechanism head pressure bridge',[0,.112,.026],[.188,.006,.008],mats.steel);
 for(const x of [-.080,.080]){
  const helix=[];for(let i=0;i<=160;i++){const t=i/160,a=t*Math.PI*16;helix.push([x+.0032*Math.cos(a),.091+.018*t,.026+.0032*Math.sin(a)]);}tube('Mechanism head pressure springs',helix,.00043,mats.bright);
  cylinder('Mechanism head spring seat',[x,.111,.026],.0045,.003,mats.brass,'y');
  cylinder('Mechanism head pressure pin',[x,.100,.026],.0014,.022,mats.bright,'y');
  box('Mechanism head articulated arm',[x,.094,.035],[.005,.006,.025],mats.steel);
  ring('Mechanism head pivot bearing',[x,.098,.025],.003,.0005,mats.brass);
  screw('Mechanism head bridge fixings',[x,.116,.026],'y');
 }
 // Auxiliary feed shaft with four separate traction bands.
 cylinder('Mechanism feed shaft',[0,.055,.023],.0025,.182,mats.bright,'x',{type:'rotate',axis:'x',speed:3.2});
 for(const x of [-.063,-.022,.022,.063]){
  cylinder('Mechanism feed traction band',[x,.055,.023],.0055,.017,mats.dark,'x',{type:'rotate',axis:'x',speed:3.2});
  for(const xx of [x-.009,x+.009])ring('Mechanism feed wheel collars',[xx,.055,.023],.0051,.0004,mats.bright);
 }
 for(const x of [-.094,.094]){
  box('Mechanism feed bearing pedestal',[x,.048,.023],[.007,.019,.016],mats.steel);
  ring('Mechanism feed bearing seal',[x,.055,.023],.0042,.0010,mats.brass);
  for(const y of [.041,.065])screw('Mechanism feed mount screws',[x,y,.032],'z');
  ring('Mechanism platen retaining ring',[x,.069,.058],.0084,.0007,mats.brass);
 }
 // Flexible flat cable and distinct copper conductors, routed under the roll.
 const path=[];for(let i=0;i<=32;i++){const t=i/32;path.push([.037,.092-.046*t+.024*Math.sin(t*Math.PI),.029-.050*t]);}
 const vertices=[],uv=[],indices=[];
 path.forEach(([x,y,z],i)=>{vertices.push(x-.006,y,z,x+.006,y,z);uv.push(0,i/32,1,i/32);if(i<32){const q=i*2;indices.push(q,q+1,q+3,q,q+3,q+2);}});
 const ribbon=new THREE.BufferGeometry();ribbon.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));ribbon.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));ribbon.setIndex(indices);ribbon.computeVertexNormals();
 const cableMat=mats.copper.clone();cableMat.side=THREE.DoubleSide;emit('Mechanism Controller flex cable',ribbon,cableMat);
 for(let i=0;i<9;i++)tube('Mechanism Controller flex traces',path.map(([x,y,z])=>[x-.0048+i*.0012,y+.0001,z]),.00009,mats.bright);
 tube('Mechanism Motor wiring rose',[[-.074,.047,.008],[-.061,.042,.01],[-.047,.044,-.005]],.0007,mats.rose);
 tube('Mechanism Motor wiring return',[[-.074,.046,.008],[-.061,.040,.009],[-.046,.043,-.006]],.0007,mats.dark);
 box('Mechanism Controller cable socket',[.037,.047,-.021],[.017,.005,.007],mats.cream);
 box('Mechanism paper path optical sensor',[-.063,.046,.057],[.012,.009,.008],mats.dark);
 box('Mechanism paper sensor aperture',[-.063,.051,.057],[.005,.001,.003],mats.rose);
 // Standoffs, cooling ribs and mounting details tie the mechanisms to the chassis.
 for(const x of [-.070,.070])for(const z of [-.048,.045]){
  cylinder('Mechanism Controller threaded standoffs',[x,.040,z],.0024,.010,mats.brass,'y');
  for(let j=0;j<5;j++)ring('Mechanism Controller thread ridges',[x,.037+j*.0011,z],.0024,.00015,mats.brass,'y');
  screw('Mechanism Controller screw heads',[x,.0455,z],'y');
 }
 for(let i=0;i<18;i++)box('Mechanism head cooling ribs',[-.067+i*.008,.087,.031],[.0012,.014,.012],mats.steel);
 // Rear enclosure: a supported paper deck and a closed roll/electronics compartment.
 const rearOpal=new THREE.MeshStandardMaterial({name:'Acrylic | rear satin rose enclosure',color:0xdfcfc7,transparent:true,opacity:.72,roughness:.42,metalness:.03,side:THREE.DoubleSide});
 const rearMetal=new THREE.MeshStandardMaterial({name:'Mechanics | rear champagne support',color:0xc9bba6,metalness:.62,roughness:.42});
 const rearLiner=new THREE.MeshStandardMaterial({name:'Mechanics | warm paper guide liner',color:0xe7ddd0,metalness:.14,roughness:.57});
 function roundedPanel(name,p,w,h,depth,mat,r=.005){
  const shape=new THREE.Shape(),x=-w/2,y=-h/2;
  shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
  const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.00035,bevelThickness:.00035,bevelSegments:2,curveSegments:10});g.translate(0,0,-depth/2);emit(name,g,mat,p);
 }
 roundedPanel('Rear enclosure paper support backplate',[0,.183,-.068],.153,.148,.0032,rearMetal,.007);
 roundedPanel('Rear enclosure recessed paper guide',[0,.183,-.0657],.141,.134,.0014,rearLiner,.006);
 roundedPanel('Rear enclosure satin backing',[0,.183,-.071],.146,.140,.002,rearOpal,.006);
 for(const x of [-.066,-.033,0,.033,.066])box('Rear enclosure pressed stiffening ribs',[x,.184,-.073],[.0024,.123,.002],rearMetal);
 for(const x of [-.078,.078]){
  box('Rear enclosure return flange',[x,.18,-.070],[.006,.141,.010],rearMetal);
  for(const y of [.121,.241]){
   cylinder('Rear enclosure standoff',[x,y,-.067],.0028,.011,mats.brass,'z');
   cylinder('Rear enclosure mounting screw',[x,y,-.074],.0018,.0012,mats.bright,'z');
   box('Rear enclosure screw slot',[x,y,-.0747],[.0022,.0004,.0002],mats.dark);
  }
 }
 roundedPanel('Rear enclosure roll chamber wall',[0,.110,-.084],.190,.050,.003,rearOpal,.008);
 roundedPanel('Rear enclosure chamber inner liner',[0,.108,-.0815],.166,.041,.0016,rearLiner,.005);
 for(const x of [-.094,.094])box('Rear enclosure chamber side return',[x,.107,-.067],[.004,.044,.035],rearOpal);
 box('Rear enclosure compartment top lip',[0,.135,-.077],[.184,.004,.020],rearMetal);
 box('Rear enclosure lower sealing seam',[0,.0858,-.087],[.185,.0012,.0014],mats.dark);
 // Close the two lower rear corners beside the existing interface panel.
 for(const side of [-1,1]){
  const x=side*.094;
  roundedPanel('Rear enclosure lower corner backing '+side,[x,.0555,-.0885],.041,.061,.002,rearLiner,.0025);
  roundedPanel('Rear enclosure lower corner shell '+side,[x,.0555,-.091],.041,.061,.0028,rearOpal,.0025);
  box('Rear enclosure lower corner return '+side,[side*.113,.0555,-.071],[.003,.061,.040],rearOpal);
  box('Rear enclosure lower corner base flange '+side,[x,.0265,-.079],[.041,.003,.025],rearMetal);
  box('Rear enclosure lower corner top flange '+side,[x,.0845,-.079],[.041,.003,.025],rearMetal);
  for(const y of [.033,.078]){
   cylinder('Rear enclosure lower corner fixing '+side,[side*.105,y,-.093],.0017,.001,mats.brass,'z');
   box('Rear enclosure lower corner screw recess '+side,[side*.105,y,-.0936],[.0019,.00035,.0002],mats.dark);
  }
 }
 // Three coaxial hinge knuckles connect the paper support to the lower chamber.
 for(const x of [-.052,0,.052])cylinder('Rear enclosure hinge barrel',[x,.112,-.075],.0032,.025,rearMetal);
 cylinder('Rear enclosure hinge pin',[0,.112,-.075],.0013,.145,mats.bright);
 roundedPanel('Rear enclosure service latch',[.065,.119,-.087],.019,.008,.002,mats.steel,.002);
 box('Rear enclosure latch finger recess',[.065,.119,-.0882],[.011,.0015,.0004],mats.dark);
 // Back surface labels are engraved geometry, kept understated at the model scale.
 for(let i=0;i<7;i++)box('Rear enclosure identification marks',[-.030+i*.006,.124,-.086],[.0035,.0006,.0004],rearMetal);
 let staticBatches=0;
 for(const {name,mat,geometries} of batches.values()){
  const g=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!g)continue;
  const mesh=new THREE.Mesh(g,mat);mesh.name=name;root.add(mesh);staticBatches++;
 }
 return {components,staticBatches,systems:['cutter motor and reduction gears','timing belt and pulleys','moving cutter and guide rails','head pressure bridge and springs','feed shaft and traction bands','bearings and retainers','flex cable and wiring','paper sensor and threaded mounts','rear paper support and enclosed roll chamber']};
}
