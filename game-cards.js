// The same stable two-digit IDs belong on the physical cards and in their QR URLs.
export const CARDS = [
  {id:'01',name:'种子',element:'SEED',symbol:'◈',mechanic:'give',color:'#bd85c6',question:'你给予得越多，它就越属于你吗？',task:'靠近红色核心，点击两次；每次点击后停一下，听它把生长归还世界。',result:'你使一颗种子萌生。它的下一次生长，不再完全由你决定。'},
  {id:'02',name:'陨石',element:'METEOR',symbol:'◇',mechanic:'give',color:'#bda2c3',question:'抵达新世界的，是你，还是你携带的智慧？',task:'点击两次，把两份养分交给陨石；中间留出一点停顿，完成一次抵达。',result:'你打开了一处新的栖息地。谁借由谁完成迁徙，仍没有答案。'},
  {id:'03',name:'土壤',element:'SOIL',symbol:'▱',mechanic:'return',color:'#98ad83',question:'如果你不再供给，这段关系还会继续吗？',task:'只点击一次，然后停下来等待六秒。给环境一次回应你的机会。',result:'你停止了供给，世界没有停下。滋养也可以向你流动。'},
  {id:'04',name:'光源',element:'LIGHT',symbol:'☼',mechanic:'balance',color:'#d0ac73',question:'照亮它的同时，你是否也规定了它的方向？',task:'分三次点击给出适量养分。每次进入标记区就停下来，不必越多越好。',result:'你没有把光推到最亮。生命在你留下的间隙里保留了自己的方向。'},
  {id:'05',name:'河流',element:'RIVER',symbol:'≈',mechanic:'give',color:'#71abb5',question:'流经你的养分，最终归属于谁？',task:'点击两次，让流动建立；每次停顿一下，让养分离开你的控制。',result:'一条河因你而出现。它经过你，却不必终止于你。'},
  {id:'06',name:'镜面',element:'MIRROR',symbol:'⌑',mechanic:'balance',color:'#b298ce',question:'它映照的是你，还是它希望你成为的样子？',task:'以三次点击与它交流。进入标记区便停下来，留出彼此的距离。',result:'你调整了自己的动作，它也改变了形态。镜子的两面都留下了影响。'},
  {id:'07',name:'根系',element:'ROOT',symbol:'⋔',mechanic:'give',color:'#95b58f',question:'连接让你走得更远，还是更难离开？',task:'点击两次建立根系。听见回应后停下来，让连接延伸到你之外。',result:'你的接触成为了一条根。连接仍在延伸，而你可以离开。'},
  {id:'08',name:'花园',element:'GARDEN',symbol:'✳',mechanic:'balance',color:'#c28ca7',question:'当每一次生长都被优化，差异还会存在吗？',task:'完成三次适量照料。不要一次喂满，观察间歇如何留下不同的枝条。',result:'这座花园没有长成同一种形状。你选择的不是效率，而是差异的余地。'},
  {id:'09',name:'回声',element:'ECHO',symbol:'◎',mechanic:'return',color:'#7fa8bc',question:'当你安静下来，它还会回应你吗？',task:'点击一次交出养分，然后停下来。六秒内不再输入，听见无声的回赠。',result:'回应出现在你不再发出指令之后。关系不只由你的声音构成。'},
  {id:'10',name:'边界',element:'BOUNDARY',symbol:'⊔',mechanic:'balance',color:'#bf977d',question:'被滋养的生命，有没有说“已经够了”的权利？',task:'三次在适量区间点击后停下来。尊重停止，而不是把每一条进度都推到极限。',result:'你三次选择了适时停止。边界没有终结关系，而是让关系得以持续。'},
  {id:'11',name:'休眠',element:'DORMANCY',symbol:'◒',mechanic:'return',color:'#9b9aaa',question:'停止生长，也可以是一种自由吗？',task:'轻轻点击一次，然后停下来等待六秒。让休眠成为你在游戏里的有效行动。',result:'你允许这个世界慢下来。没有继续增长，并不等于没有发生。'},
  {id:'12',name:'未知',element:'UNKNOWN',symbol:'∴',mechanic:'return',color:'#a597ca',question:'如果没有预设答案，你还愿意与它共同生长吗？',task:'给予一点，然后放手。等待六秒，看一次不由你继续操控的变化。',result:'你完成的不是一个答案，而是一次把未来交还给关系的尝试。'},
];

export function getCard(value){
  const id=String(value ?? '').padStart(2,'0');
  return CARDS.find(card=>card.id===id) ?? null;
}

export function createSession(card,now=0){
  return {card,status:'active',total:0,dose:0,rounds:0,releasedAt:null,startedAt:now,progress:0,message:card.task};
}

export function addNutrient(session,amount){
  if(session.status==='complete'||(session.card.mechanic==='balance'&&session.rounds>=3)||!Number.isFinite(amount)||amount<=0)return;
  session.total+=amount;session.dose+=amount;session.releasedAt=null;
  if(session.card.mechanic==='give'){
    session.progress=Math.min(82,session.total/.3*82);
    session.message=session.total>=.3?'已经足够。停下来，让这次生长离开你的控制。':'再点击一次，然后停下来听它的回应。';
  }else if(session.card.mechanic==='balance'){
    session.progress=Math.min(100,session.dose/.42*100);
    session.message=session.dose>.3?'这次给得太多了。停一下再试，已经完成的照料会保留。':session.dose>=.12?'这一份养分已经足够。停下来听它的回应。':'点击一次，进入适量区间后停下来。';
  }else{
    session.progress=Math.min(25,session.total/.14*25);
    session.message=session.total>=.14?'现在停下来，六秒内不再输入。它也可以反过来滋养你。':'只需要点击一次，然后给它一些时间。';
  }
}

export function releaseNutrient(session,now){
  if(session.status==='complete'||(session.card.mechanic==='balance'&&session.rounds>=3))return;
  if(session.card.mechanic==='balance'){
    if(session.dose>=.12&&session.dose<=.3)session.rounds++;
    session.message=session.rounds===3?'三次适量照料已经完成。观察这段关系留下的形态。':session.dose>=.12&&session.dose<=.3?`已完成 ${session.rounds} / 3 次照料，再点击一次。`:'这一份不在适量区间。重新靠近，轻点后停下来。';
    session.dose=0;session.progress=session.rounds/3*100;
    if(session.rounds===3){session.status='settling';session.releasedAt=now;}
  }else{
    const enough=session.total>=(session.card.mechanic==='give'?.3:.14);
    if(enough){session.status='settling';session.releasedAt=now;session.message=session.card.mechanic==='give'?'释放正在发生。你的输入正在成为这个世界的一部分。':'放手也是一个动作。等待六秒，让它回应你。';}
    else session.message='回应还没有完成。再点击一次，然后停下来。';
    session.dose=0;
  }
}

export function advanceSession(session,now){
  if(session.status!=='settling'||session.releasedAt===null)return false;
  const seconds=session.card.mechanic==='return'?6:2.5;
  const q=Math.max(0,Math.min(1,(now-session.releasedAt)/seconds));
  if(session.card.mechanic==='return'){
    session.progress=25+q*75;
    session.message=`不用再输入。等待它回赠 · ${Math.ceil(seconds*(1-q))} 秒`;
  }else if(session.card.mechanic==='give')session.progress=82+q*18;
  if(q===1){session.status='complete';session.progress=100;session.message=session.card.result;return true;}
  return false;
}
