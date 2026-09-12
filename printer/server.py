#!/usr/bin/env python3
"""Local, persistent Chladni artwork jobs, dice relay and explicit CUPS printing. No cloud dependency.
Serves the whole BETWEEN repository so the symbol console and the printer scene share one origin."""
import json, math, os, random, re, secrets, sqlite3, subprocess, threading, time
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from garden_style import STYLE,ai_prompt,render_garden
from rarity import rarity_for
from story import story_for

ROOT=Path(__file__).resolve().parent
SITE=ROOT.parent
JOBS_URL='/printer/jobs'
DB=ROOT/'jobs'/'archive.sqlite3'; DB.parent.mkdir(exist_ok=True)
PORT=int(os.getenv('PORT','8765'))
LOCK=threading.RLock()
DICE={'values':[],'at':None}; DICE_FRESH=5.0
def connect():
    con=sqlite3.connect(DB); con.row_factory=sqlite3.Row; return con
with connect() as db:
    db.execute('CREATE TABLE IF NOT EXISTS jobs (seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL, id TEXT UNIQUE, data TEXT NOT NULL)')
def save(job):
    with connect() as db: db.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(job,ensure_ascii=False),job['id']))
def get_job(jid):
    with connect() as db: row=db.execute('SELECT data FROM jobs WHERE id=?',(jid,)).fetchone()
    if not row: raise ValueError('找不到这个作品编号')
    return json.loads(row[0])
def check_coefficients(a,b):
    if not all(math.isfinite(v) for v in [a,b]) or abs(a)>1 or abs(b)>1 or a*a+b*b<.05: raise ValueError('模态系数无效')
def seed_of(data):
    seed=int(data.get('seed',secrets.randbits(32)))
    if not 0<=seed<=0xffffffff: raise ValueError('随机种子无效')
    return seed
def params(data):
    if 'cards' in data: return card_params(data)
    m,n=int(data.get('m',3)),int(data.get('n',5))
    if not(1<=m<=12 and 1<=n<=12 and m!=n): raise ValueError('请选择两张不同的 1–12 号牌')
    a,b=float(data.get('a',.8)),float(data.get('b',.6)); check_coefficients(a,b)
    seed=seed_of(data)
    return {'m':min(m,n),'n':max(m,n),'a':a,'b':b,'seed':seed,'intensity':m+n,'formula_version':'chladni-v1'}
def card_params(data):
    # The formula always needs two modes: one card fixes m and the seed draws n; two cards are the usual pair.
    cards=data['cards']
    if not isinstance(cards,list) or len(cards) not in (1,2): raise ValueError('请提供一张或两张卡')
    cards=[int(c) for c in cards]
    if not all(1<=c<=12 for c in cards) or len(set(cards))!=len(cards): raise ValueError('请选择一张或两张不同的 01–12 号卡')
    seed=seed_of(data); rng=random.Random(seed)
    if len(cards)==2: m,n=min(cards),max(cards)
    else: m=cards[0]; n=rng.choice([k for k in range(1,13) if k!=m])
    # Same mixing rule as the seed plate: θ in 10°–80°, random sign for the second mode.
    theta=math.radians(10+rng.random()*70); sign=1 if rng.random()<.5 else -1
    a,b=float(data.get('a',math.cos(theta))),float(data.get('b',sign*math.sin(theta))); check_coefficients(a,b)
    return {'m':m,'n':n,'a':a,'b':b,'seed':seed,'intensity':m+n,'formula_version':'chladni-v1','cards':cards,'n_source':'card' if len(cards)==2 else 'random'}
def create(data):
    p=params(data); key=str(data.get('request_id') or secrets.token_hex(16))[:128]
    with LOCK,connect() as db:
        row=db.execute('SELECT data FROM jobs WHERE request_id=?',(key,)).fetchone()
        if row: return json.loads(row[0])
        cur=db.execute('INSERT INTO jobs (request_id,data) VALUES (?,?)',(key,'{}'))
        jid=f'SG-{datetime.now():%Y%m%d}-{cur.lastrowid:04d}-{p["seed"]:08X}'
        job={'id':jid,'params':p,'rarity':rarity_for(p['m'],p['n']),'story':story_for(p),'created_at':datetime.now().isoformat(),'status':'generating',
             'revises':str(data.get('revises',''))[:80],'generator':'local_garden','style_version':STYLE['version'],'style_scale':STYLE['scale'],'print_status':'not_submitted','request_id':key}
        db.execute('UPDATE jobs SET id=?,data=? WHERE seq=?',(jid,json.dumps(job),cur.lastrowid))
    threading.Thread(target=generate,args=(jid,),daemon=True).start()
    return job
def generate(jid):
    job=get_job(jid); p=job['params']; folder=ROOT/'jobs'/jid; folder.mkdir(exist_ok=True)
    try:
        # Same two-mode field and gradient projection as the supplied input panel.
        rng=np.random.default_rng(p['seed']); N=round(2000+(p['m']+p['n']-3)/20*10000)
        x=rng.random(N)*7; y=rng.random(N)*12
        start=np.stack((x/7,y/12),axis=1)
        pm,pn=math.pi*p['m'],math.pi*p['n']; a,b=p['a'],p['b']
        for tick in range(320):
            u,v=x/7,y/12
            f=a*np.cos(pm*u)*np.cos(pn*v)+b*np.cos(pn*u)*np.cos(pm*v)
            gx=-(a*pm*np.sin(pm*u)*np.cos(pn*v)+b*pn*np.sin(pn*u)*np.cos(pm*v))/7
            gy=-(a*pn*np.cos(pm*u)*np.sin(pn*v)+b*pm*np.cos(pn*u)*np.sin(pm*v))/12
            k=.55*f/(gx*gx+gy*gy+1e-4); dx,dy=-k*gx,-k*gy
            lim=np.maximum(1,np.hypot(dx,dy)/.25); amp=(.16*max(0,1-tick/260)+.004)*np.minimum(1,np.abs(f))
            x+=dx/lim+(rng.random(N)-.5)*amp; y+=dy/lim+(rng.random(N)-.5)*amp
            x=np.abs(x); x=np.where(x>7,14-x,x); y=np.abs(y); y=np.where(y>12,24-y,y)
        end=np.stack((x/7,y/12),axis=1)
        (folder/'particles.json').write_text(json.dumps({'initial':start[:2400].round(5).tolist(),'final':end[:2400].round(5).tolist()}))
        # A new image rendered from mathematical data, not an edit of a supplied image.
        W,H=1400,2400; im=Image.new('RGB',(W,H),'#f4ebd8'); draw=ImageDraw.Draw(im)
        draw.rectangle((42,42,W-42,H-42),outline='#b0a089',width=2)
        draw.rectangle((54,54,W-54,H-54),outline='#d2c3ae',width=1)
        for i in range(N):
            xx=100+x[i]/7*1200; yy=210+y[i]/12*1920; radius=float(rng.uniform(1.3,2.8))
            col=['#aa6268','#bd7a7f','#c99094','#8e6867'][i%4]
            draw.ellipse((xx-radius,yy-radius,xx+radius,yy+radius),fill=col)
        fontpath='/System/Library/Fonts/Supplemental/Georgia.ttf'
        fnt=ImageFont.truetype(fontpath,36) if Path(fontpath).exists() else ImageFont.load_default()
        small=ImageFont.truetype(fontpath,20) if Path(fontpath).exists() else ImageFont.load_default()
        draw.text((W/2,110),'EMERGENCE / CHLADNI',font=fnt,fill='#645349',anchor='mm')
        draw.text((W/2,2225),f'MODE {p["m"]} + {p["n"]}   /   a {a:.4f}   b {b:.4f}',font=small,fill='#796757',anchor='mm')
        draw.text((W/2,2285),jid,font=small,fill='#796757',anchor='mm')
        im.save(folder/'guide.png')
        im=render_garden(p)
        im.save(folder/'artwork.png')
        (folder/'ai_prompt.txt').write_text(ai_prompt(p))
        story=job['story'];(folder/'story.json').write_text(json.dumps(story,ensure_ascii=False,indent=2))
        (folder/'story.txt').write_text(story['title']+'\n\n'+story['story']+'\n\n'+story['question'])
        # Portable A5 proof: exact 7:12 image aspect, no crop. Media adapts later to the real printer.
        pdf=canvas.Canvas(str(folder/'artwork.pdf'),pagesize=(148*mm,210*mm))
        pdf.setTitle(jid); pdf.setAuthor('BETWEEN / Chladni rule generator')
        pdf.drawImage(ImageReader(im),21.5*mm,15*mm,width=105*mm,height=180*mm)
        pdf.setFillColorRGB(.35,.27,.25);pdf.setFont('Helvetica',6)
        pdf.drawCentredString(74*mm,9*mm,jid+' / GARDEN')
        rarity=rarity_for(p['m'],p['n']);pdf.setFont('Helvetica',5.5)
        pdf.drawCentredString(74*mm,6*mm,f'SUM {rarity["sum"]} | {rarity["token"]} | {rarity["ways"]}/66 ({rarity["percent"]}%)')
        pdf.showPage(); pdf.save()
        job.update(status='ready',ready_at=datetime.now().isoformat(),image=f'{JOBS_URL}/{jid}/artwork.png',pdf=f'{JOBS_URL}/{jid}/artwork.pdf',particles=f'{JOBS_URL}/{jid}/particles.json',particle_count=N)
        (folder/'manifest.json').write_text(json.dumps(job,ensure_ascii=False,indent=2))
    except Exception as e: job.update(status='failed',error=str(e))
    save(job)
def dice_state():
    age=None if DICE['at'] is None else round(time.time()-DICE['at'],2)
    live=age is not None and age<=DICE_FRESH
    return {'values':DICE['values'] if live else [],'age':age,'live':live}
def set_dice(data):
    # Pushed by hardware/dice_push.py, ordered left to right: growth die, relation die.
    values=data.get('values')
    if not isinstance(values,list) or len(values)>6: raise ValueError('骰子读数无效')
    values=[int(v) for v in values]
    if not all(1<=v<=6 for v in values): raise ValueError('骰子点数必须是 1–6')
    DICE.update(values=values,at=time.time()); return dice_state()
def printers():
    try:
        r=subprocess.run(['lpstat','-p'],capture_output=True,text=True,timeout=4,env={**os.environ,'LC_ALL':'C'})
        return re.findall(r'^printer\s+(\S+)',r.stdout,re.M)
    except (FileNotFoundError,subprocess.TimeoutExpired): return []
def print_job(jid,printer):
    with LOCK:
        job=get_job(jid)
        if job['status']!='ready': raise ValueError('作品文件尚未准备好')
        if job['print_status'] in ['submitted','submitting','uncertain']: return job
        if not printer or printer not in printers(): raise ValueError('打印机未连接或未添加，请先在系统中添加纸张打印机')
        job.update(print_status='submitting',printer=printer); save(job)
        try:
            r=subprocess.run(['lp','-d',printer,'-t',jid,str(ROOT/'jobs'/jid/'artwork.pdf')],capture_output=True,text=True,timeout=12,env={**os.environ,'LC_ALL':'C'})
            if r.returncode: job.update(print_status='failed',print_error=r.stderr.strip())
            else:
                found=re.search(r'request id is (\S+)',r.stdout)
                job.update(print_status='submitted',cups_job_id=found.group(1) if found else r.stdout.strip())
        except subprocess.TimeoutExpired: job.update(print_status='uncertain',print_error='提交超时；先在系统打印队列核实，不要重复发送')
        except FileNotFoundError: job.update(print_status='failed',print_error='系统没有 CUPS 打印命令')
        save(job); return job
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw): super().__init__(*args,directory=str(SITE),**kw)
    def send_json(self,data,status=200):
        raw=json.dumps(data,ensure_ascii=False).encode(); self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        path=urlparse(self.path).path
        try:
            if path=='/api/printers': return self.send_json({'printers':printers()})
            if path=='/api/health': return self.send_json({'ok':True,'generator':'local_garden','style_version':STYLE['version'],'style_scale':STYLE['scale'],'ai_image_provider':False})
            if path=='/api/dice': return self.send_json(dice_state())
            if path.startswith('/api/jobs/'): return self.send_json(get_job(path.split('/')[3]))
            # The site root is a git checkout: never serve dotfiles, the job database or server code.
            plain=unquote(path)
            if any(part.startswith('.') for part in plain.split('/')) or plain.endswith(('.sqlite3','.py','.pyc','.log')): return self.send_error(403)
            return super().do_GET()
        except ValueError as e: self.send_json({'error':str(e)},404)
    def do_POST(self):
        # Bind to loopback and require same-origin requests; no remote website can print.
        origin=self.headers.get('Origin')
        if origin and origin not in [f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}']: return self.send_json({'error':'origin rejected'},403)
        path=urlparse(self.path).path; length=int(self.headers.get('Content-Length','0'))
        if path=='/api/recording':
            if length>80_000_000: return self.send_error(413)
            (ROOT/'recomposition.webm').write_bytes(self.rfile.read(length)); return self.send_json({'ok':True})
        if length>10000: return self.send_error(413)
        try:
            data=json.loads(self.rfile.read(length) or '{}')
            if path=='/api/jobs': return self.send_json(create(data),201)
            if path=='/api/dice': return self.send_json(set_dice(data))
            if re.fullmatch(r'/api/jobs/[A-Za-z0-9-]+/print',path): return self.send_json(print_job(path.split('/')[3],data.get('printer')))
            self.send_error(404)
        except (ValueError,TypeError,OverflowError,KeyError) as e: self.send_json({'error':str(e)},400)
    def log_message(self,fmt,*args): print(fmt%args,flush=True)
if __name__=='__main__':
    # Interrupted computation is explicit after a restart; uncertain printing never auto-retries.
    with connect() as db:
        for row in db.execute('SELECT data FROM jobs').fetchall():
            job=json.loads(row[0])
            if job.get('status')=='generating': job.update(status='failed',error='生成服务曾重启，请重新生成'); save(job)
            if job.get('print_status')=='submitting': job.update(print_status='uncertain'); save(job)
    print(f'Open http://127.0.0.1:{PORT}/prototype-3d.html',flush=True)
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
