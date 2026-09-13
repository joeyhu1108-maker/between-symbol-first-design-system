import {writeFile, readFile} from 'node:fs/promises';
import {glyphsFirst} from './glyphs-first.mjs';
import {glyphsLast} from './glyphs-last.mjs';
const glyphs = [...glyphsFirst,...glyphsLast];
const root=new URL('../',import.meta.url);
const centers=JSON.parse(await readFile(new URL('./centers.json',import.meta.url),'utf8'));
export const segments={idle:[0,240],hover:[240,288],tap:[288,396]};
const fixed=k=>({a:0,k});
const rgb=hex=>hex.match(/[\da-f]{2}/gi).map(v=>parseInt(v,16)/255).concat(1);
// SVG and Lottie share this geometry. Tangents are relative to their vertices.
function path(d){
 const tokens=d.match(/[A-Za-z]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g);let j=0,cmd,current=[0,0];
 const result={i:[],o:[],v:[],c:false};
 const point=()=>[Number(tokens[j++]),Number(tokens[j++])];
 const add=p=>{result.v.push(p);result.i.push([0,0]);result.o.push([0,0]);current=p;};
 while(j<tokens.length){
  if(/[A-Za-z]/.test(tokens[j]))cmd=tokens[j++];
  if(cmd==='M'){if(result.v.length)throw Error('Use separate parts for subpaths');add(point());cmd='L';}
  else if(cmd==='L')add(point());
  else if(cmd==='C'||cmd==='Q'){
   let a=point(),b=point(),end=cmd==='C'?point():b;
   if(cmd==='Q'){b=[end[0]+(a[0]-end[0])*2/3,end[1]+(a[1]-end[1])*2/3];a=[current[0]+(a[0]-current[0])*2/3,current[1]+(a[1]-current[1])*2/3];}
   result.o[result.o.length-1]=a.map((n,i)=>n-current[i]);add(end);result.i[result.i.length-1]=b.map((n,i)=>n-end[i]);
  }else if(cmd==='Z'){result.c=true;cmd=null;}else throw Error(`Unsupported path command ${cmd}`);
 }
 if(result.c&&result.v.length>1&&result.v.at(-1).every((v,i)=>v===result.v[0][i])){result.i[0]=result.i.pop();result.o.pop();result.v.pop();}
 return result;
}
function keyframes(part,property,base,convert=x=>x){
 if(!Object.keys(segments).some(state=>part[state]?.[property]))return fixed(convert(base));
 const points=[];
 for(const [state,[start,end]] of Object.entries(segments)){
  const values=part[state]?.[property]||[[0,base],[1,base]];
  if(values[0][0]!==0||values.at(-1)[0]!==1)throw Error(`${part.name} ${state} ${property}: missing endpoints`);
  if(JSON.stringify(values[0][1])!==JSON.stringify(base)||JSON.stringify(values.at(-1)[1])!==JSON.stringify(base))throw Error(`${part.name} ${state} ${property}: must return to base`);
  for(const [time,value] of values){const t=start+time*(end-start);if(points.at(-1)?.t===t)points.pop();points.push({t,value:convert(value)});}
 }
 return {a:1,k:points.map((p,i)=>({t:p.t,s:property==='path'?[p.value]:Array.isArray(p.value)?p.value:[p.value],...(i<points.length-1?{e:property==='path'?[points[i+1].value]:Array.isArray(points[i+1].value)?points[i+1].value:[points[i+1].value],o:{x:.4,y:0},i:{x:.2,y:1}}:{})}))};
}
function shape(part){
 let geom;
 if(part.circle){const [x,y,r]=part.circle;geom={ty:'el',p:fixed([x,y]),s:fixed([r*2,r*2]),d:1,nm:part.name};}
 else {
  const parsed=path(part.d);for(const state of Object.keys(segments))for(const [,d] of part[state]?.path||[])if(path(d).v.length!==parsed.v.length)throw Error(`Topology mismatch ${part.name}`);
  geom={ty:'sh',ks:keyframes(part,'path',part.d,path),nm:part.name};
 }
 return [geom,part.stroke?{ty:'st',c:fixed(rgb(part.stroke)),o:fixed(100),w:fixed(part.width||14),lc:2,lj:2,nm:'ink'}:{ty:'fl',c:fixed(rgb(part.fill)),o:fixed(100),r:1,nm:'ink'}];
}
function animation(glyph){return {v:'5.13.0',fr:60,ip:0,op:397,w:362,h:362,nm:`BETWEEN / ${glyph.name} / ${glyph.relation}`,ddd:0,assets:[],markers:Object.entries(segments).map(([name,[tm,end]])=>({cm:JSON.stringify({name}),tm,dr:end-tm})),layers:glyph.parts.map((part,index)=>{
 const pivot=part.pivot||[181,181];
 return {ddd:0,ind:index+1,ty:4,nm:part.name,sr:1,ip:0,op:397,st:0,bm:0,ao:0,ks:{a:fixed([...pivot,0]),p:keyframes(part,'p',[0,0],v=>[v[0]+pivot[0]+centers[glyph.id][0],v[1]+pivot[1]+centers[glyph.id][1],0]),r:keyframes(part,'r',0),s:keyframes(part,'s',[100,100],v=>[...v,100]),o:keyframes(part,'o',100)},shapes:shape(part)};
 }).reverse()};}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function svg(glyph){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 362 362" width="362" height="362"><title>${glyph.name} · ${glyph.relation}</title><g id="normalized" transform="translate(${centers[glyph.id].join(',')})">${glyph.parts.map(p=>`<g id="${p.name}">${p.circle?`<circle cx="${p.circle[0]}" cy="${p.circle[1]}" r="${p.circle[2]}" fill="${p.fill}"/>`:`<path d="${escape(p.d)}" ${p.stroke?`fill="none" stroke="${p.stroke}" stroke-width="${p.width||14}" stroke-linecap="round" stroke-linejoin="round"`:`fill="${p.fill}"`}/>`}</g>`).join('')}</g></svg>`;}
const metadata=[];
for(const glyph of glyphs){
 const anim=animation(glyph);const data=JSON.stringify(anim);
 await writeFile(new URL(`animations/${glyph.id}.json`,root),data);
 await writeFile(new URL(`vectors/${glyph.id}.svg`,root),svg(glyph));
 metadata.push({id:glyph.id,name:glyph.name,relation:glyph.relation,verb:glyph.verb,story:glyph.story,parts:glyph.parts.length,bytes:Buffer.byteLength(data)});
}
await writeFile(new URL('manifest.json',root),JSON.stringify(metadata,null,2));
await writeFile(new URL('src/manifest.mjs',root),`export default ${JSON.stringify(metadata,null,2)};\n`);
console.log(`Built ${metadata.length} Lottie animations, ${metadata.reduce((s,g)=>s+g.parts,0)} semantic parts; ${(metadata.reduce((s,g)=>s+g.bytes,0)/1024).toFixed(1)} KB total.`);
