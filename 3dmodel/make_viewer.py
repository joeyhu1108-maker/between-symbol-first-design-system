#!/usr/bin/env python3
"""把 out/printer.glb 内嵌进一个可双击打开的 Three.js 查看器（无需本地服务器）。"""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent
glb = (ROOT / "out" / "printer.glb").read_bytes()
b64 = base64.b64encode(glb).decode()

html = f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>星环中的萌生 · 输出端</title>
<style>html,body{{margin:0;height:100%;background:#FAFAF8;overflow:hidden;font:12px/1.5 -apple-system,"PingFang SC",sans-serif;color:#6E7178}}
#tip{{position:fixed;left:16px;bottom:14px;letter-spacing:.06em}}</style></head><body>
<div id="tip">拖动旋转 · 滚轮缩放 · 右键平移</div>
<script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/"}}}}</script>
<script type="module">
import * as THREE from 'three';
import {{OrbitControls}} from 'three/addons/controls/OrbitControls.js';
import {{GLTFLoader}} from 'three/addons/loaders/GLTFLoader.js';
import {{RoomEnvironment}} from 'three/addons/environments/RoomEnvironment.js';
const r=new THREE.WebGLRenderer({{antialias:true}});r.setPixelRatio(devicePixelRatio);r.setSize(innerWidth,innerHeight);
r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.05;r.shadowMap.enabled=true;document.body.appendChild(r.domElement);
const s=new THREE.Scene();s.background=new THREE.Color(0xFAFAF8);
s.environment=new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(),0.04).texture;
const cam=new THREE.PerspectiveCamera(32,innerWidth/innerHeight,1,5000);cam.position.set(-520,-720,380);cam.up.set(0,0,1);
const ctl=new OrbitControls(cam,r.domElement);ctl.target.set(0,0,110);ctl.enableDamping=true;
const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(-400,-500,700);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{{left:-500,right:500,top:500,bottom:-500,far:2000}});s.add(key);
s.add(new THREE.HemisphereLight(0xffffff,0xd8dadd,0.6));
const g=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.ShadowMaterial({{opacity:0.16}}));g.receiveShadow=true;s.add(g);
const bin=Uint8Array.from(atob("{b64}"),c=>c.charCodeAt(0));
new GLTFLoader().parse(bin.buffer,'',gltf=>{{
  gltf.scene.traverse(o=>{{if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;const m=o.material;
    if(o.name==='shell'){{m.transparent=true;m.opacity=0.28;m.roughness=0.25;m.transmission=0.85;m.thickness=6;m.ior=1.49;m.side=THREE.DoubleSide;o.castShadow=false;}}
    if(o.name==='paper'){{m.side=THREE.DoubleSide;}} }});
  s.add(gltf.scene);}});
addEventListener('resize',()=>{{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();r.setSize(innerWidth,innerHeight)}});
(function loop(){{ctl.update();r.render(s,cam);requestAnimationFrame(loop)}})();
</script></body></html>"""
out = ROOT / "out" / "viewer.html"
out.write_text(html, encoding="utf-8")
print(out, f"{out.stat().st_size/1e6:.1f} MB")
