import sharp from '/Users/huzhuoyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';
import {readFile,writeFile} from 'node:fs/promises';
const centers={};
for(let n=1;n<=12;n++){const id=String(n).padStart(2,'0');let svg=await readFile(new URL(`../vectors/${id}.svg`,import.meta.url));svg=Buffer.from(svg.toString().replace(/<g id="normalized" transform="[^"]*">/,'').replace(/<\/g><\/svg>$/,'</svg>'));const {data,info}=await sharp(svg).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=362,y0=362,x1=0,y1=0;for(let y=0;y<362;y++)for(let x=0;x<362;x++)if(data[(y*362+x)*4+3]>127){x0=Math.min(x,x0);x1=Math.max(x,x1);y0=Math.min(y,y0);y1=Math.max(y,y1);}centers[id]=[181-(x0+x1)/2,181-(y0+y1)/2];}
await writeFile(new URL('./centers.json',import.meta.url),JSON.stringify(centers,null,2));console.log(centers);
