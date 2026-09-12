"""Curatorial emotional grammar for the twelve BETWEEN relationship cards.
Card ids and names mirror ../game-cards.js (verify.mjs checks they stay in sync).
These are artistic interpretations of parameters, not psychological measurements.
"""
CARDS={
1:('种子','萌生','想在给予中长成自己','a small dense pigment knot beginning to open outward'),
2:('陨石','抵达','想抵达一个新的世界','a displaced mark arriving from outside the field, trailing a faint path'),
3:('土壤','回赠','想在停止供给后仍被回应','a low layered ground wash that gives colour back upward'),
4:('光源','照亮','想照亮而不规定方向','a soft luminous bloom that leaves its shadows undirected'),
5:('河流','流经','想让养分流过而不被占有','a meandering translucent band passing through without ending'),
6:('镜面','映照','想看清彼此真正的样子','two mirrored contours that never quite coincide'),
7:('根系','连接','想连接，也保留离开的路','fine branching threads spreading beneath other layers'),
8:('花园','差异','想让每一次生长都不一样','several unequal pigment territories, none repeated'),
9:('回声','回响','想在安静之后听见回应','faint concentric returns echoing an earlier mark'),
10:('边界','适时停止','想说出“已经够了”','an edge that halts a wash before it fills the field'),
11:('休眠','休眠','想慢下来，也仍然在发生','a still, pale resting zone with very sparse marks'),
12:('未知','共同生长','想和它一起长成未知的样子','two pigment territories sharing an irregular unclassified boundary')
}

def story_for(p):
 m,n=sorted((p['m'],p['n']));a,b=float(p['a']),float(p['b']);den=abs(a)+abs(b)
 human=abs(a)/den;seed=abs(b)/den;balance=1-abs(human-seed)
 ca,cb=CARDS[m],CARDS[n]
 out={'title':ca[1]+'与'+cb[1],'screen_title':'两种愿望，<br>开始改变彼此。',
 'story':f'一条痕迹{ca[2]}，另一条痕迹{cb[2]}。它们在同一片色域中靠近，也留下各自的修改痕迹。最后，一段空白没有被任何一方完全覆盖。',
 'screen_line':f'{ca[2]}，也{cb[2]}。两种愿望改变了彼此的边界，却仍保留一处没有被覆盖的空白。',
 'question':'你愿意把哪一处空白，留给尚未发生的关系？','anchors':[ca[3],cb[3]]}
 perspective='种子／AI 视角更明显' if seed>.6 else '人的视角更明显' if human>.6 else '两种视角接近'
 relation='牵制与保留边界' if b<0 else '交叠与相互滋养'
 signature=['未闭合的小环','一条偏离框架的细线','被擦掉后又描回的痕迹','一次迟疑的断笔','一处没有补上的缝'][p['seed']%5]
 out.update(version='between-story-v1',cards=[{'index':m,'id':f'{m:02d}','name':ca[0],'theme':ca[1],'wish':ca[2]},{'index':n,'id':f'{n:02d}','name':cb[0],'theme':cb[1],'wish':cb[2]}],
   perspective=perspective,relation=relation,signature=signature,
   measures={'human_view_share':round(human,4),'seed_view_share':round(seed,4),'balance':round(balance,4),'rhythm_gap':n-m,'accumulation':m+n},
   interpretation='叙事权重与视觉隐喻，不是观众的人格或情绪测量。')
 out['anchors'].append('a boundary kept visibly open' if b<0 else 'one small zone where the two pigment families overlap without erasing either')
 return out

def story_prompt(p):
 s=story_for(p);return '\n'.join([
  'Emotional narrative: '+s['title']+' — '+s['story'],
  'Two card motives: '+', '.join(c['name']+' / '+c['theme']+' / '+c['wish'] for c in s['cards']),
  'Perspective: '+s['perspective']+'. Relation: '+s['relation']+'. An individual trace: '+s['signature'],
  'Show emotion through abstract visual evidence: '+'; '.join(s['anchors']),
  'Do not depict literal people, crowns, plants, tools or organs. Keep the approved pink/pale-lilac palette, 20% oil character and handmade nonstandard details. Do not write the story into the image.'
 ])
