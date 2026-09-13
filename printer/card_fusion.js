import * as THREE from 'three';

const smooth=(a,b,t)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u)};

// Printed cards share the printer's camera, depth buffer and assembly space.
export async function createCardFusion({scene,renderer,ids}){
 const textures=await Promise.all(ids.map(id=>new THREE.TextureLoader().loadAsync(`../assets/print-cards/${id}-seed.webp`)));
 const geometry=new THREE.BoxGeometry(.160,.240,.0012);
 const cards=textures.map((texture,i)=>{
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const edge=new THREE.MeshStandardMaterial({color:0xd8c9a9,roughness:.88,transparent:true});
  const face=new THREE.MeshBasicMaterial({map:texture,toneMapped:false,transparent:true});
  const back=new THREE.MeshStandardMaterial({color:0xf0e5cb,roughness:.92,transparent:true});
  const mesh=new THREE.Mesh(geometry,[edge,edge,edge,edge,face,back]);
  mesh.name=`Fusion card ${ids[i]}`;scene.add(mesh);
  return {mesh,materials:[edge,face,back],side:i===0?-1:1};
 });
 const canvas=renderer.domElement;canvas.dataset.cardFusionIds=ids.join(',');
 let reduced=false;
 return {
  reset(value){reduced=value;},
  get offset(){return reduced?.4:1.8;},
  get duration(){return reduced?.8:3.2;},
  update(elapsed,camera,idle=false){
   const t=idle?0:elapsed,fit=Math.min(1,camera.aspect/1.05),duration=reduced?.8:3.2;
   const fold=reduced?smooth(0,.8,t):smooth(.35,2.5,t);
   const enter=reduced?smooth(.15,.8,t):smooth(1.3,3.2,t);
   const scale=reduced?1-.06*enter:1-.38*smooth(1.35,2.35,t)-.62*smooth(2.35,3.2,t);
   const opacity=reduced?1-smooth(.15,.8,t):1-smooth(2.5,3.2,t);
   for(const {mesh,materials,side} of cards){
    mesh.visible=t<duration;
    mesh.position.set(side*(.104*(1-fold)+.012*fold)*fit,.135+(.026*Math.sin(Math.PI*fold)-.064*enter)*fit,.17-.105*enter+side*.021*Math.sin(Math.PI*fold));
    mesh.rotation.set(reduced?0:.055*Math.sin(Math.PI*fold),reduced?-side*.12:-side*(.22+.85*Math.sin(Math.PI*fold)),reduced?-side*.035:side*(-.075+.23*Math.sin(Math.PI*fold)));
    mesh.scale.setScalar(Math.max(.001,scale)*fit);
    materials.forEach(material=>{material.opacity=opacity;});
   }
   const phase=t>=duration?'complete':idle?'ready':reduced?'settling':t<.65?'approach':t<2.35?'folding':'converging';
   canvas.dataset.cardFusion=phase;
   return t<duration;
  },
  dispose(){cards.forEach(({mesh,materials})=>{mesh.removeFromParent();materials.forEach(material=>material.dispose());});geometry.dispose();textures.forEach(texture=>texture.dispose());}
 };
}
