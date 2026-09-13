"""Draw a NEW geometry-layout diagram for imagegen; never modifies the base painting."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw

def render(brief,out,size=(980,1640)):
 w,h=size;im=Image.new('RGB',(w,h),'#F7F0E8');d=ImageDraw.Draw(im)
 for e in brief['geometry']:
  cx,cy=e['u']*w,e['v']*h;ww,hh=e['width']*w,e['height']*h;angle=math.radians(e['rotation_degrees'])
  def xy(x,y):return (cx+x*math.cos(angle)-y*math.sin(angle),cy+x*math.sin(angle)+y*math.cos(angle))
  def line(points,fill=e['color'],width=None):d.line([xy(x,y) for x,y in points],fill=fill,width=width or max(5,int(ww*.08)),joint='curve')
  def polygon(points,fill=e['color']):d.polygon([xy(x,y) for x,y in points],fill=fill)
  motif=e['motif'];x,y=ww/2,hh/2
  if motif in ['open_frame','offset_frame','shared_frame','ghost_frame']:
   pts=[(-x,y),(-x,-y),(x,-y),(x,y),(x*.22,y)]
   if motif=='ghost_frame':line([(a+7,b+7) for a,b in pts],fill='#D3B7C4',width=3)
   line(pts)
   if motif in ['offset_frame','shared_frame']:line([(-x*.65,y*.5),(-x*.65,-y*.65),(x*1.2,-y*.65)],width=max(4,int(ww*.055)))
  elif motif in ['disc','broken_ring','half_disc']:
   span=math.pi if motif=='half_disc' else math.tau*.83 if motif=='broken_ring' else math.tau
   pts=[(x*math.cos(t),y*math.sin(t)) for t in [k*span/80 for k in range(81)]]
   if motif=='disc':polygon(pts)
   elif motif=='half_disc':polygon(pts+[(0,0)])
   else:line(pts)
  elif motif=='triangle':polygon([(-x,y),(x*.78,y*.7),(x*.24,-y)])
  elif motif=='diamond':polygon([(0,-y),(x,0),(-x*.10,y),(-x,0)])
  elif motif=='bar_pair':
   line([(-x,-y*.55),(x,-y*.45)],width=max(6,int(hh*.1)))
   line([(-x*.75,y*.5),(x*.85,y*.6)],width=max(5,int(hh*.08)))
  elif motif=='chevron':polygon([(-x,-y),(0,-y*.2),(-x*.4,y*.3),(x*.25,y),(x,y*.55),(x*.3,0),(x*.7,-y*.6)])
  elif motif=='notched_strip':polygon([(-x,-y),(x*.7,-y),(x*.15,-y*.4),(x,y*.1),(x*.2,y*.4),(x*.65,y),(-x,y)])
 Path(out).parent.mkdir(parents=True,exist_ok=True);im.save(out)
 return str(out)

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('brief');p.add_argument('out');a=p.parse_args();render(json.loads(Path(a.brief).read_text()),a.out)
