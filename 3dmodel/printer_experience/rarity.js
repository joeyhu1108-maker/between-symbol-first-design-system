export function rarityFor(m,n){
 const sum=m+n;let ways=0;for(let i=1;i<=12;i++)for(let j=i+1;j<=12;j++)if(i+j===sum)ways++;
 const kind=sum===3?'origin':sum===23?'palimpsest':ways<=3?'rare':'common';
 const labels={origin:'极值 · 初生',palimpsest:'极值 · 未命名',rare:'低频 · 偶然偏移',common:'常见 · 共生花园'};
 return {sum,ways,totalPairs:66,probability:ways/66,percent:(ways/66*100).toFixed(2),kind,label:labels[kind],density:{origin:.22,palimpsest:1,rare:.8,common:.62}[kind],spin:{origin:.10,palimpsest:.32,rare:.24,common:.20}[kind]};
}
