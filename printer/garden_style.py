"""One fixed style contract for AI prompts and the local procedural preview."""
import json,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from rarity import rarity_for,rarity_prompt
from story import story_for,story_prompt
ROOT=Path(__file__).resolve().parent
STYLE=json.loads((ROOT/'garden_style.json').read_text())
def ai_prompt(p):
    return '\n'.join([
        'Create one original, very abstract painting titled conceptually GARDEN. A seed becomes a field of relationships, not a depicted plant.',
        'Fixed style: '+json.dumps(STYLE['scale']),
        rarity_prompt(p['m'],p['n']),
        story_prompt(p),
        'Palette balance: 55% pink/rose/blush, 25% very pale lilac, 15% warm cream, 5% muted accents. Reduce cool blue and green. Preserve the established abstract Garden composition language.',
        'Medium: 80% airy translucent painterly layers, 20% oil-painted character: selective thin impasto, brush ridges and scraped edges. Gentle aged decay: fine craquelure, rubbed pigment, small flakes exposing warm ground, faint fading. Keep luminous; no dark dirty grunge.',
        'Handmade details: broken loops, incomplete bent frameworks, irregular hatching, seam-like marks, double-traced misregistered contours, erased and revealed shapes, tiny illegible note-like marks. Cluster details locally at mixed scales; do not apply a uniform stamped texture. Preserve breathing space.',
        'Keep this palette: '+', '.join(STYLE['palette'].values()),
        'Use asymmetrical, off-center, overlapping color territories. Hand-painted gouache, oil-pastel and thin watercolor washes. The garden is an abstract ecosystem of color, not an illustration.',
        f'Input Chladni variables: m={p["m"]}, n={p["n"]}, a={p["a"]}, b={p["b"]}, individual seed={p["seed"]}. Use nodal relationships to bend composition and boundaries, without drawing a literal grid.',
        'Portrait aspect 7:12. Full-bleed image, no frame, labels or numbers; numbering is typeset outside the painting in the print document.',
        'Exclude: '+', '.join(STYLE['exclude']),
        'Invent a fresh composition within this fixed visual language. Do not reproduce any reference composition.'
    ])
def render_garden(p,size=(1400,2400)):
    """Render a code-native abstract color field; this is labelled local generation, not AI inference."""
    W,H=size;rng=np.random.default_rng(p['seed']);w,h=700,1200
    u,v=np.meshgrid(np.linspace(0,1,w,dtype=np.float32),np.linspace(0,1,h,dtype=np.float32))
    palette=list(STYLE['palette'].values())
    rgb=lambda s:np.array([int(s[i:i+2],16) for i in (1,3,5)],dtype=np.float32)
    base=np.ones((h,w,3),np.float32)*rgb(palette[0])
    rarity=rarity_for(p['m'],p['n']);kind=rarity['kind'];emotion=story_for(p)
    phase=rng.uniform(0,math.tau,3)
    warp=.075*np.sin(p['m']*math.pi*u+phase[0])*np.cos(p['n']*math.pi*v+phase[1])
    warp_offset=warp*(.5+p['a']); sine_offset=.05*np.sin(u*8+phase[2])
    # Broad asymmetrical pigment territories; fixed palette, variable placement.
    for k in range(3 if kind=='origin' else 28 if kind=='palimpsest' else 14 if kind=='rare' else 17):
        cx,cy=rng.uniform(-.15,1.15),rng.uniform(-.08,1.08);sx,sy=rng.uniform(.12,.43),rng.uniform(.09,.34)
        sx*=.55+emotion['measures']['human_view_share' if k%2==0 else 'seed_view_share']
        if kind=='origin': sx*=.52;sy*=.52
        if kind=='palimpsest': sx*=1.10;sy*=1.12
        dx=u-cx+warp_offset;dy=v-cy+sine_offset
        angle=rng.uniform(-2,2);x=dx*math.cos(angle)-dy*math.sin(angle);y=dx*math.sin(angle)+dy*math.cos(angle)
        power=1.2 if k%3==0 else 2.4
        dist=np.abs(x/sx)**power+np.abs(y/sy)**power
        mask=np.clip((1.3-dist)*3,0,1) if k%3==0 else np.exp(-dist*1.4)
        mask*=rng.uniform(.32,.8)
        color=rgb(palette[[1,3,4,2,5,3,6,1,7,8,3,4,0,1,2,0,6][k%17]])
        base=base*(1-mask[:,:,None])+color*mask[:,:,None]
    relief=(np.sin(u*125+v*18+warp*15)*np.sin(v*82+phase[0]))[:,:,None]
    oilmask=(np.sin(u*9+v*6+phase[1])>.65)[:,:,None]
    base+=relief*oilmask*STYLE['scale'].get('oil_paint_presence',0)*18
    abrasion=(rng.random((h,w))>.995)[:,:,None]
    base=np.where(abrasion,.45*base+.55*rgb(palette[0]),base)
    grain=rng.normal(0,2.1,(h,w,1)).astype(np.float32)
    fibers=2*np.sin(u*780+v*11)[:,:,None]+1.5*np.sin(v*930)[:,:,None]
    im=Image.fromarray(np.uint8(np.clip(base+grain+fibers,0,255))).resize((W,H),Image.Resampling.BICUBIC).convert('RGB')
    draw=ImageDraw.Draw(im,'RGBA')
    # Wandering modal marks, detached from a literal diagram or recognizable plant.
    for i in range(12 if kind=='origin' else 120 if kind=='palimpsest' else 55+p['m']+p['n']):
        xx,yy=rng.uniform(-.1,1.1),rng.uniform(0,1);length=rng.uniform(.06,.32);direction=rng.choice([-1,1])
        pts=[]
        for q in np.linspace(0,1,65):
            x=xx+q*length*direction;y=yy+.045*math.sin(x*p['m']*math.pi+p['b']*3)+q*rng.uniform(-.003,.003)
            pts.append((x*W,y*H))
        color=(*rgb(palette[int(rng.choice([0,1,2,3,7,8]))]).astype(int),int(rng.uniform(45,120)))
        draw.line(pts,fill=color,width=int(rng.integers(1,5)))
    for i in range(210):
        x,y=rng.uniform(0,W),rng.uniform(0,H);r=rng.uniform(1,5)
        draw.ellipse((x-r,y-r,x+r,y+r),fill=(156,62,92,int(rng.uniform(20,85))))
    # Local irregular detail pockets; no uniform grids or legible lettering.
    pockets=2 if kind=='origin' else 18 if kind=='palimpsest' else 9
    for j in range(pockets):
        cx,cy=rng.uniform(.08,.92)*W,rng.uniform(.1,.9)*H
        width=rng.uniform(30,125);height=rng.uniform(25,160)
        col=(139,96,116,int(rng.uniform(70,145)))
        if j%3==0:
            pts=[(cx-width*.5,cy+height*.45),(cx-width*.45,cy-height*.35),(cx+width*.4,cy-height*.5),(cx+width*.52,cy+height*.25)]
            draw.line(pts,fill=col,width=int(rng.integers(1,4)))
            draw.line([(x+3,y-2) for x,y in pts[:3]],fill=(192,137,159,60),width=1)
            for q in range(int(rng.integers(3,10))):
                xx=cx-width*.4+q*width/9+rng.uniform(-5,5)
                draw.line([(xx,cy-height*.28),(xx+rng.uniform(-12,12),cy+height*rng.uniform(.05,.42))],fill=col,width=1)
        elif j%3==1:
            for q in range(int(rng.integers(7,22))):
                x0=cx+q*width/20;y0=cy+rng.uniform(-height*.15,height*.15)
                draw.line([(x0,y0),(x0+rng.uniform(-5,8),y0+height*rng.uniform(.1,.7))],fill=col,width=int(rng.integers(1,3)))
        else:
            pts=[(cx+width*.45*math.sin(t*5),cy+height*.4*math.cos(t*3)+rng.uniform(-3,3)) for t in np.linspace(0,rng.uniform(1.2,3.5),50)]
            draw.line(pts,fill=col,width=2)
    # A small relational anchor remains legible inside the abstract field.
    anchor=[(.23*W,.49*H),(.39*W,.43*H),(.54*W,.46*H),(.69*W,.42*H)]
    if p['b']<0:
        draw.line(anchor[:2],fill=(151,106,132,130),width=3);draw.line(anchor[2:],fill=(151,106,132,130),width=2)
    else: draw.line(anchor,fill=(176,124,146,100),width=3)
    if 11 in (p['m'],p['n']): draw.line([(.73*W,.65*H),(.79*W,.58*H)],fill=(245,232,222,220),width=9)
    return im.convert('RGB')
