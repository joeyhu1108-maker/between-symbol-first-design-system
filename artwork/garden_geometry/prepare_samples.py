from pathlib import Path
from PIL import Image
import json
from compose import compose,write_brief,ROOT
from render_guide import render
samples=[('01_attraction_power',dict(card_ids=[3,5],numbers=[3,5],a=.27576837112805397,b=-.9612241182395393,seed=333341133,question=None),'base_attraction_power.png'),('02_care_inversion',dict(card_ids=[4,9],numbers=[4,9],a=.82,b=.57236352,seed=91827364,question=None),'base_care_inversion.png')]
index=[]
for name,inputs,base in samples:
 brief=compose(**inputs);out=write_brief(brief,ROOT/'outputs'/name)
 with Image.open(ROOT/'assets'/base) as image:render(brief,out/'geometry_guide.png',image.size)
 (out/'request.json').write_text(json.dumps(inputs,ensure_ascii=False,indent=2)+'\n')
 index.append({'folder':name,'artwork_id':brief['artwork_id'],'base':'assets/'+base,'guide':'outputs/'+name+'/geometry_guide.png','prompt':'outputs/'+name+'/prompt.txt','story':brief['story']['title'],'input':inputs})
(ROOT/'samples.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(index,ensure_ascii=False,indent=2))
