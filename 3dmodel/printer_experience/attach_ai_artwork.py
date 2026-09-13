"""Attach a real AI result to an unprinted job; preserve the rule guide and provenance."""
import argparse,json,shutil
from pathlib import Path
from datetime import datetime
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from server import ROOT,get_job,save
from rarity import rarity_for

def attach(jid,image):
    job=get_job(jid)
    if job['print_status']!='not_submitted': raise ValueError('Cannot change an artwork after printing was requested')
    if job.get('generator')=='ai_imagegen': raise ValueError('AI result already attached; create a new edition instead')
    source=Path(image).resolve()
    with Image.open(source) as im: im.verify()
    folder=ROOT/'jobs'/jid
    if not (folder/'guide.png').exists(): shutil.copy2(folder/'artwork.png',folder/'guide.png')
    shutil.copy2(folder/'artwork.pdf',folder/'guide.pdf')
    shutil.copy2(source,folder/'ai_original.png')
    pdf=canvas.Canvas(str(folder/'artwork.pdf'),pagesize=(148*mm,210*mm))
    pdf.setTitle(jid);pdf.setAuthor('星环中的萌生 / AI interpretation of Chladni inputs')
    pdf.drawImage(str(folder/'ai_original.png'),21.5*mm,23*mm,width=105*mm,height=180*mm,preserveAspectRatio=True,anchor='c')
    pdf.setFillColorRGB(.37,.29,.25);pdf.setFont('Helvetica',6.5);pdf.drawCentredString(74*mm,15*mm,jid)
    p=job['params'];pdf.setFont('Helvetica',5.5)
    pdf.drawCentredString(74*mm,11*mm,f'MODE {p["m"]} + {p["n"]} | a {p["a"]:.6f} | b {p["b"]:.6f} | seed {p["seed"]}')
    rarity=rarity_for(p['m'],p['n']);pdf.drawCentredString(74*mm,7*mm,f'SUM {rarity["sum"]} | {rarity["token"]} | {rarity["ways"]}/66 ({rarity["percent"]}%)')
    pdf.showPage();pdf.save()
    job.update(generator='ai_imagegen',image=f'/jobs/{jid}/ai_original.png',source_guide=f'/jobs/{jid}/guide.png',
               ai_provenance={'provider':'built-in imagegen','mode':'offline_generated_sample','attached_at':datetime.now().isoformat(),'source_image':source.name},status='ready')
    save(job);(folder/'manifest.json').write_text(json.dumps(job,ensure_ascii=False,indent=2))
    print(json.dumps({'id':jid,'image':job['image'],'pdf':job['pdf']},ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('job');p.add_argument('image');a=p.parse_args();attach(a.job,a.image)
