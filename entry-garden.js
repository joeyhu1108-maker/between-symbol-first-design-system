import {mountGlyph} from './symbol-interface.js?v=card-fusion-3d-1';

// The twelve existing animated symbols surround the central card shuffle.
const garden=document.getElementById('entryGarden');
const panel=document.getElementById('entryPanel');
const colors=['#ca7367','#d7a645','#66938b','#9480aa','#ce8163'];
let randomState=128;
const random=()=>{randomState=(randomState*1664525+1013904223)>>>0;return randomState/4294967296};
const symbols=Array.from({length:12},(_,i)=>{
  const angle=(i*30-90)*Math.PI/180;
  return {id:String(i+1).padStart(2,'0'),x:50+35*Math.cos(angle),y:50+34*Math.sin(angle)};
});
const svgParts=[];
symbols.forEach((symbol,i)=>{
  const x=symbol.x*16,y=symbol.y*9,color=colors[i%colors.length];
  const cx=800+(x-800)*.38+(i%2?80:-80),cy=450+(y-450)*.52;
  svgParts.push(`<path d="M800 450 Q${cx} ${cy} ${x} ${y}" fill="none" stroke="${color}" stroke-width=".8" stroke-dasharray="1 5" opacity=".55"/>`);
  for(let j=0;j<48;j++){
    const a=random()*Math.PI*2,r=35+random()*96;
    svgParts.push(`<circle cx="${x+Math.cos(a)*r}" cy="${y+Math.sin(a)*r*.95}" r="${.65+random()*2.3}" fill="${color}" opacity="${.27+random()*.42}"/>`);
  }
});
for(let i=0;i<160;i++){
  const a=i/160*Math.PI*2,r=i%5===0?7:3;
  const x=800+245*Math.cos(a),y=450+245*Math.sin(a);
  svgParts.push(`<path d="M${x} ${y} l${r*Math.cos(a)} ${r*Math.sin(a)}" stroke="#a69a7f" stroke-width=".65" opacity=".48"/>`);
}
const orbitDots=Array.from({length:62},(_,i)=>{
  const a=i/62*Math.PI*2;
  return `<circle cx="${800+603*Math.cos(a)}" cy="${450+321*Math.sin(a)}" r="${i%5===0?4.5:1.6}" fill="${colors[i%colors.length]}" opacity=".7"/>`;
}).join('');
garden.innerHTML=`
  <svg class="garden-orbits" viewBox="0 0 1600 900" preserveAspectRatio="none">
    <g fill="none" stroke="#ab9a7c" stroke-width=".7" opacity=".48">
      <ellipse cx="800" cy="450" rx="560" ry="306" stroke-dasharray="1 5"/>
      <ellipse cx="800" cy="450" rx="576" ry="318"/>
    </g>
    ${svgParts.join('')}
    <g class="garden-orbit-dots">${orbitDots}</g>
  </svg>
  <div class="garden-symbols">${symbols.map(symbol=>`
    <div class="garden-symbol" data-symbol-id="${symbol.id}" style="--x:${symbol.x}%;--y:${symbol.y}%"></div>`).join('')}</div>
  <div class="garden-center-ring"></div>
  <div class="garden-frame"><i></i><i></i><i></i><i></i></div>
  <div class="garden-dust">${Array.from({length:18},(_,i)=>`<i style="--a:${i*20}deg;--r:${26+i%4*3}vmin;--delay:${-i*1.1}s;--ink:${colors[i%colors.length]}"></i>`).join('')}</div>`;

garden.querySelectorAll('.garden-symbol').forEach(host=>mountGlyph(host,host.dataset.symbolId,{ambient:true}));

// Only the surrounding symbols follow the pointer; the central cards keep their rhythm.
const motion=matchMedia('(prefers-reduced-motion: reduce)');
let frame=0;
panel.addEventListener('pointermove',event=>{
  if(motion.matches||frame||event.pointerType==='touch')return;
  frame=requestAnimationFrame(()=>{
    garden.style.setProperty('--pointer-x',`${(event.clientX/innerWidth-.5)*12}px`);
    garden.style.setProperty('--pointer-y',`${(event.clientY/innerHeight-.5)*9}px`);
    frame=0;
  });
});
panel.addEventListener('pointerleave',()=>{
  garden.style.setProperty('--pointer-x','0px');garden.style.setProperty('--pointer-y','0px');
});
