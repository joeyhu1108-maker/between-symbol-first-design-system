"""Isolated artwork brief composer. Does not import or mutate printer code or jobs."""
import argparse,hashlib,json,math,random,secrets,unicodedata,copy
from pathlib import Path
if __package__:
 from .captions import select_caption,caption_instruction
 from .presentation import layout_spec,annotation_instruction
else:
 from captions import select_caption,caption_instruction
 from presentation import layout_spec,annotation_instruction
ROOT=Path(__file__).resolve().parent
SOURCES={x['id']:x for x in json.loads((ROOT/'card_sources.json').read_text())}
ROLES={int(k):v for k,v in json.loads((ROOT/'card_roles.json').read_text()).items()}
STYLE=json.loads((ROOT/'style_snapshot.json').read_text())
VERSION='garden-geometry-semantic-v1'
QUESTION_THEMES={
 'choice':(['选择','决定','留下','离开','去留','放弃','开始'],['triangle','open_frame'],'a fork or opening, with neither route presented as the correct answer'),
 'trust':(['信任','相信','安全','依赖'],['shared_frame','half_disc'],'partial support and translucency; one edge remains visible rather than completely covered'),
 'boundary':(['边界','拒绝','自由','控制','自己'],['open_frame','broken_ring'],'an opening and a nearby piece retaining its own orientation'),
 'care':(['照顾','照料','付出','回应','爱','陪伴'],['half_disc','disc'],'a receiving form and one returning connector, with space preserved for both'),
 'loss':(['失去','告别','忘记','遗憾','记忆'],['ghost_frame','notched_strip'],'an absent segment and a retained earlier trace; no literal tragedy'),
 'change':(['改变','成长','未来','变化','方向'],['diamond','offset_frame'],'a gently shifted alignment with one shared continuation')
}
PAIRS={
 (1,2):('被接住之后','陌生痕迹被一处开口承接。接着，测量与整理的线靠近它；最后才发现，那些看似外来的支撑，也从它的底层延伸出来。','安心与轻微的不确定同时存在'),
 (3,5):('是谁借谁抵达','柔软的色域让一枚小片靠近，一套框架随后承接了它的方向。看起来是框架在决定去处，底层的细线却悄悄显示：支撑框架的力量来自那片被带走的颜色。','亲密、主动选择与隐约的依赖交织'),
 (4,9):('换一个方向看照料','一处温柔的凹面收拢细线，像不断接受给予。另一枚倒置的几何片露出下层：流向它的颜色也正在被分隔和归档。温柔仍在，但给予者的痕迹变得可见。','温暖之中出现迟疑与被看见的渴望'),
 (11,12):('空位也参与生长','重叠的旧边界中，一小段主动缺席了。两类不同的形状由此共享一条支撑，而退出的那枚小片保留了自己的方向；新的关系不急着封口。','克制、释放与开放的希望')
}

def _ids(values,label):
 if len(values)!=2 or any(type(v) is not int or not 1<=v<=12 for v in values) or values[0]==values[1]:
  raise ValueError(label+' must contain two distinct integer values in 1..12')
 return list(values)

def question_signals(question):
 if question is None:return {'provided':False,'text':None,'sha256':None,'themes':[],'geometry_actions':[],'motifs':[]}
 if not isinstance(question,str):raise ValueError('question must be a string or null')
 text=' '.join(unicodedata.normalize('NFKC',question).split())
 if not text:return question_signals(None)
 if len(text)>2000:raise ValueError('question is too long')
 themes=[k for k,(words,_,_) in QUESTION_THEMES.items() if any(w in text for w in words)]
 return {'provided':True,'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest(),'themes':themes,
         'geometry_actions':[QUESTION_THEMES[k][2] for k in themes[:2]],
         'motifs':list(dict.fromkeys(m for k in themes[:2] for m in QUESTION_THEMES[k][1]))}

def field(u,v,m,n,a,b):
 return a*math.cos(math.pi*m*u)*math.cos(math.pi*n*v)+b*math.cos(math.pi*n*u)*math.cos(math.pi*m*v)

def numeric_anchors(rng,m,n,a,b,count):
 result=[]
 for j in range(count):
  candidates=[]
  for k in range(180):
   u,v=rng.uniform(.12,.88),rng.uniform(.12,.88)
   for _ in range(14):
    f=field(u,v,m,n,a,b)
    du=-math.pi*(a*m*math.sin(math.pi*m*u)*math.cos(math.pi*n*v)+b*n*math.sin(math.pi*n*u)*math.cos(math.pi*m*v))
    dv=-math.pi*(a*n*math.cos(math.pi*m*u)*math.sin(math.pi*n*v)+b*m*math.cos(math.pi*n*u)*math.sin(math.pi*m*v))
    step=.5*f/(du*du+dv*dv+1e-5)
    u=max(.10,min(.90,u-step*du));v=max(.10,min(.90,v-step*dv))
   distance=min((math.hypot(u-x,v-y) for x,y in result),default=.5)
   candidates.append((abs(field(u,v,m,n,a,b))+max(0,.22-distance)*5,u,v))
  _,u,v=min(candidates);result.append((u,v))
 return result

def compose(card_ids,numbers=None,a=None,b=None,seed=None,question=None,orientations=None,caption_question_id=None):
 ids=_ids(card_ids,'card_ids');nums=_ids(numbers if numbers is not None else ids,'numbers')
 orientations=['both','both'] if orientations is None else orientations
 if len(orientations)!=2 or any(x not in ['upright','reversed','both'] for x in orientations):raise ValueError('invalid orientations')
 if seed is None:seed=secrets.randbits(32)
 if type(seed) is not int or not 0<=seed<=0xffffffff:raise ValueError('seed must be uint32')
 if (a is None)!=(b is None):raise ValueError('provide both a and b, or neither')
 if a is None:
  r=random.Random(seed);theta=math.radians(r.uniform(10,80));a=math.cos(theta);b=math.sin(theta)*r.choice([-1,1])
 if not all(type(v) in (float,int) and math.isfinite(v) and abs(v)<=1 for v in [a,b]) or a*a+b*b<.05:raise ValueError('invalid coefficients')
 if 12 in ids and orientations[ids.index(12)]=='reversed':raise ValueError('World has no reversed state in this project')
 q=question_signals(question);m,n=sorted(nums)
 canonical={'card_ids':ids,'numbers':nums,'orientations':orientations,'a':a,'b':b,'seed':seed,'question':q['text'],'version':VERSION,'style':STYLE['version']}
 digest=hashlib.sha256(json.dumps(canonical,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 derived_seed=int(digest[:16],16);rng=random.Random(derived_seed)
 total=m+n;ways=sum(i+j==total for i in range(1,13) for j in range(i+1,13))
 records=[]
 for cid,orientation in zip(ids,orientations):
  src=SOURCES[cid];role=ROLES[cid]
  records.append({'id':cid,'name':src['name'],'theme':src['theme'],'source':src['source'],'source_sha256':src['source_sha256'],'orientation':'unified' if cid==12 else orientation,**copy.deepcopy(role)})
 key=tuple(sorted(ids))
 if key in PAIRS:title,story,emotion=PAIRS[key]
 else:
  c1,c2=records
  title=c1['theme']+'与'+c2['theme']
  story=f'一种痕迹{c1["desire"]}，另一种痕迹{c2["desire"]}。靠近之后，原先的关系被重新阅读：{c1["seed"]}；{c2["seed"]}。'
  emotion=c1['cost']+'；'+c2['cost']
 # Select which account is available, without treating coefficient sign as tarot orientation.
 viewpoints=[]
 for c in records:
  if c['id']==12:
   viewpoints.append('世界／共同视角：'+c['seed']);continue
  if c['orientation'] in ['both','upright']:viewpoints.append(c['name']+'／人看种子：'+c['human'])
  if c['orientation'] in ['both','reversed']:viewpoints.append(c['name']+'／种子看人：'+c['seed'])
 count=3+(total-3)//6
 anchors=numeric_anchors(rng,m,n,a,b,count)
 elements=[]
 for i,(u,v) in enumerate(anchors):
  owner=records[i%2]
  motif=rng.choice(q['motifs']) if i==count-1 and q['motifs'] else rng.choice(owner['motifs'])
  size=rng.uniform(.10,.16)*(1.08 if total==23 else .82 if total==3 else 1)
  elements.append({'id':f'g{i+1}','motif':motif,'semantic_card':owner['id'],'meaning':owner['visual_rule'],
    'u':round(u,5),'v':round(v,5),'width':round(size,4),'height':round(size*(7/12 if motif in ['disc','broken_ring','half_disc'] else rng.uniform(.65,1.4)),4),
    'rotation_degrees':round(rng.uniform(-1,1)*(8+(n-m)*2.4),1),'layer':i,
    'color':rng.choice(list(STYLE['palette'].values())[:6]),'material':'painted thin relief, imperfect edge, 20% oil character',
    'nodal_residual':round(abs(field(u,v,m,n,a,b)),6)})
 human=abs(a)/(abs(a)+abs(b))
 relation='near but not sealed: preserve a meaningful gap' if b<0 else 'partial overlap or a shared support, without total enclosure'
 if abs(a)<1e-8 or abs(b)<1e-8:relation='one modal direction is visible; keep the alternate account as a faint trace rather than mutual overlap'
 brief={'schema_version':VERSION,'artwork_id':f'GDN-{m:02}{n:02}-'+''.join(f'{i:02}' for i in ids)+f'-{seed:08X}-{digest[:8]}',
  'input':canonical,'question':q,'cards':records,
  'numeric_layer':{'m':m,'n':n,'sum':total,'gap':n-m,'a':a,'b':b,'ways':ways,'total_pairs':66,'probability':ways/66,'human_view_share':human,'seed_view_share':1-human,'geometry_count':count,'spatial_relation':relation,'derived_seed':derived_seed},
  'story':{'title':title,'text':story,'emotion':emotion,'viewpoints':viewpoints,'required_evidence':[c['visual_rule'] for c in records]+[relation],
           'question_influence':q['geometry_actions'],'interpretation':'Artistic relational fiction, not a personality assessment or a prediction.'},
  'geometry':elements,'style':copy.deepcopy(STYLE),'production':{'status':'brief_ready','image_generated':False,'question_is_placeholder':not q['provided']}}
 brief['presentation']=layout_spec()
 brief['caption_question']=select_caption(brief,caption_question_id)
 brief['presentation_id']=brief['artwork_id']+f'-Q{brief["caption_question"]["id"]:02d}'
 return brief

def prompt_for(brief):
 n=brief['numeric_layer'];s=brief['story'];q=brief['question'];caption=brief.get('caption_question') or select_caption(brief)
 return '\n'.join([
  'EDIT IMAGE 1 as the BASE PAINTING. IMAGE 2 is the geometric-layout guide; IMAGE 3 is a geometric-relief example ONLY. IMAGE 4, when supplied, demonstrates only the organic annotation layer; do not copy its painting, composition or palette.',
  'Keep image1 color territories, overall composition, pink/rose and VERY PALE lilac palette, fine aged texture, nonstandard marks and breathing spaces. Add only a restrained geometric layer, covering roughly 5–12 percent of the painting.',
  'Create several small groups of geometric relief: offset/incomplete frames, painted discs, triangles, notched strips, half discs and diamonds, chosen from the plan below. Like handmade painted card or thin wood with softly worn edges and low-relief shadows. Some thin elements may be partially buried by translucent paint. No crisp UI icon sheet or factory-perfect CAD symmetry.',
  f'Numeric structure: m={n["m"]}, n={n["n"]}, a={n["a"]}, b={n["b"]}, sum={n["sum"]}, seed={brief["input"]["seed"]}. The guide anchors are computed near the Chladni-inspired nodal field. Follow their relative locations and sizes approximately; let handmade variation remain.',
  'STORY MUST BE VISIBLE IN THE RELATIONS BETWEEN THE GEOMETRIES: '+s['title']+' — '+s['text'],
  'Emotional tension: '+s['emotion'],
  'Card accounts: '+' | '.join(s['viewpoints']),
  'Required visual evidence: '+' | '.join(s['required_evidence']),
  'Geometry plan: '+json.dumps(brief['geometry'],ensure_ascii=False),
  ('Player question: '+q['text']+'. Let this influence the relationship and these actions: '+'; '.join(q['geometry_actions'])+'. Keep the question open; do not write or claim to answer it.' if q['provided'] else 'No player question was supplied. Do not invent a personal question or biography.'),
  'Preserve approximately 20% oil-painted character, selective fine cracks, worn pigment and imperfect repeated drawing. Geometry uses the BASE palette: blush, dusty rose, warm cream, very pale lilac. Do not copy green, blue or yellow from image3.',
  'The painting area remains an extremely abstract GARDEN, without literal flowers, plants, seeds, organisms, people, crowns, furniture or watermark. Micro labels from the organic annotation layer are the only readable writing allowed. Each card needs one visible motif and an interaction. Preserve the complete painting. Deliver the annotated inner artwork at 2:3 portrait; extend peripheral painted texture slightly if necessary, never cut away key objects. Do not depict a mat, wood frame or footer inside this source image: exact A4 mounting is handled by layout_a4.py.',
  annotation_instruction(brief),
  caption_instruction(caption)
 ])

def write_brief(brief,out):
 out=Path(out);out.mkdir(parents=True,exist_ok=True)
 (out/'brief.json').write_text(json.dumps(brief,ensure_ascii=False,indent=2)+'\n')
 (out/'prompt.txt').write_text(prompt_for(brief)+'\n')
 (out/'caption.json').write_text(json.dumps(brief.get('caption_question') or select_caption(brief),ensure_ascii=False,indent=2)+'\n')
 (out/'story.md').write_text('# '+brief['story']['title']+'\n\n'+brief['story']['text']+'\n\n'+brief['story']['emotion']+'\n\n'+('\n'.join('- '+x for x in brief['story']['viewpoints']))+'\n')
 return out

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--out',required=True);args=p.parse_args()
 data=json.loads(Path(args.input).read_text());brief=compose(**data);write_brief(brief,args.out);print(brief['artwork_id'])

# Integration helper for the existing input panel; caller explicitly supplies card IDs
# if the printed numbers and card identity become independent later.
def compose_from_seed_plate(snapshot,question=None,card_ids=None,orientations=None,caption_question_id=None):
    if not all(k in snapshot for k in ['m','n','a','b']):raise ValueError('incomplete seed-plate snapshot')
    seed=snapshot.get('seed',snapshot.get('seedNum'))
    if seed is None:raise ValueError('the original seed is required for traceability')
    numbers=[snapshot['m'],snapshot['n']]
    return compose(numbers if card_ids is None else card_ids,numbers=numbers,a=snapshot['a'],b=snapshot['b'],seed=seed,question=question,orientations=orientations,caption_question_id=caption_question_id)
