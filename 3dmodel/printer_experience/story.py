"""Curatorial emotional grammar grounded in the project's twelve card stories.
These are artistic interpretations of parameters, not psychological measurements.
"""
import math
CARDS={
1:('愚者','初遇','想被接住','an isolated pigment trace approaching an open space'),
2:('魔术师','使用','想改变世界','incomplete alignment marks that guide without fully enclosing'),
3:('恋人','吸引与选择','想被理解','soft leaning contours and an inviting incomplete loop'),
4:('皇后','孕育','想照料对方','partially nested translucent washes and a returning thread'),
5:('皇帝','权力','想把不确定安放好','a skew framework attempting to contain a fluid pigment field'),
6:('教皇','信仰','想找到可以相信的答案','repeated faint marks with one uncertain interruption'),
7:('战车','驾驭','想保留自己的方向','two strained trajectories connected by a frayed seam'),
8:('命运之轮','循环','想知道谁在改变谁','returning paths and traces reappearing under later layers'),
9:('倒吊人','翻转','想换个位置重新看见','an inverted contour revealing an overlooked route'),
10:('死神','替换','想留下不可替代的痕迹','rubbed-out layers with one stubborn double-traced remnant'),
11:('隐士','退出','想保留停止和拒绝的权利','a conspicuous unpainted gap and a line leaving the field'),
12:('世界','相互生成','想共同长成未知的样子','two pigment territories sharing an irregular unclassified boundary')
}
PAIRS={
(1,2):{
 'title':'第一次被接住','screen_title':'第一次，<br>有人接住。',
 'story':'一个陌生的痕迹落进空白，另一条线靠近，为它留出可以停下的位置。被接住让它安心，也让它开始改变。最后，那道边界仍然没有封口。',
 'screen_line':'少量痕迹第一次靠近。承接它的线没有封口，安放与自由同时存在。',
 'question':'接住一个生命，是否也能为它留下离开的空间？',
 'anchors':['one small off-center trace supported by an incomplete sheltering line','a large untouched interval; the shelter remains open']},
(3,5):{
 'title':'被理解，也保留自己','screen_title':'被理解，<br>也保留自己。',
 'story':'一片柔软的颜色向另一片靠近，像终于有人听懂了它。后来，承接它的线慢慢变成框架。它没有离开，只让一条细线穿过缝隙，留下一段不能被安排的路。',
 'screen_line':'柔软色域被框架承接，也逐渐被它包围。一条未闭合的细线，为自己保留方向。',
 'question':'当一种关系足够懂你，你还希望它留下什么未知？',
 'anchors':['soft blush pigment partly held by a skew incomplete framework','one delicate line slipping through a gap; never close the boundary']},
(4,9):{
 'title':'照料的方向','screen_title':'照料，<br>也需要回应。',
 'story':'最先伸出去的那一笔，一直在把颜色交给别处。换一个方向看，才发现那些淡下去的地方也需要被托住。后来，一条很细的痕迹折返回来，停在它曾经付出的边缘。',
 'screen_line':'一片颜色不断向外给予；换个方向，一条细线折返，托住最先伸出去的那一笔。',
 'question':'照料会流向哪里，又是否有人看见给予者的空白？',
 'anchors':['a translucent wash giving pigment toward another territory','an inverted returning thread reaching back toward a faded edge']},
(11,12):{
 'title':'没有名字，也可以生长','screen_title':'没有名字，<br>也可以生长。',
 'story':'它第一次停止接受。旧的层次没有消失，过去的痕迹仍然挤在一起。但有一道边界被它留空了：从那里，它把积累的颜色还给周围，也长出一个不再需要被归类的方向。',
 'screen_line':'密集旧层里保留一道没有修补的缺口。停止、归还与新的生长，同时发生。',
 'question':'如果可以不再被命名，这座花园会把什么还给世界？',
 'anchors':['many accumulated paint layers, one conspicuous open gap','a nonstandard trace escaping the repeated framework and entering a shared space']}
}

def story_for(p):
 m,n=sorted((p['m'],p['n']));a,b=float(p['a']),float(p['b']);den=abs(a)+abs(b)
 human=abs(a)/den;seed=abs(b)/den;balance=1-abs(human-seed)
 ca,cb=CARDS[m],CARDS[n]
 generic={'title':ca[1]+'与'+cb[1],'screen_title':'两种愿望，<br>开始改变彼此。',
 'story':f'一条痕迹{ca[2]}，另一条痕迹{cb[2]}。它们在同一片色域中靠近，也留下各自的修改痕迹。最后，一段空白没有被任何一方完全覆盖。',
 'screen_line':f'{ca[2]}，也{cb[2]}。两种愿望改变了彼此的边界，却仍保留一处没有被覆盖的空白。',
 'question':'你愿意把哪一处空白，留给尚未发生的关系？','anchors':[ca[3],cb[3]]}
 out=dict(PAIRS.get((m,n),generic));out['anchors']=list(out['anchors'])
 perspective='种子／AI 视角更明显' if seed>.6 else '人的视角更明显' if human>.6 else '两种视角接近'
 relation='牵制与保留边界' if b<0 else '交叠与相互滋养'
 signature=['未闭合的小环','一条偏离框架的细线','被擦掉后又描回的痕迹','一次迟疑的断笔','一处没有补上的缝'][p['seed']%5]
 out.update(version='garden-story-v1',cards=[{'index':m,'name':ca[0],'theme':ca[1],'wish':ca[2]},{'index':n,'name':cb[0],'theme':cb[1],'wish':cb[2]}],
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
