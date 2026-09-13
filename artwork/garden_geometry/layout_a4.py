"""Place generated painting and wood imagery in an exact A4 document.

No painting pixels are retouched. PDF page geometry controls the frame and mat;
the PNG is a 300 dpi rendering of that document, rather than another AI edit.
"""
import argparse, hashlib, json, os
from pathlib import Path
import fitz
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
try:
    from .presentation import PAGE_MM, WOOD_MM, MAT_MM, layout_spec
except ImportError:
    from presentation import PAGE_MM, WOOD_MM, MAT_MM, layout_spec

def render(artwork, wood_source, destination):
    artwork, wood_source, destination = map(Path, (artwork, wood_source, destination))
    destination.mkdir(parents=True, exist_ok=True)
    pdf = destination/'artwork_A4.pdf'
    png = destination/'artwork_A4.png'
    w,h = (v*mm for v in PAGE_MM)
    rail, mat = WOOD_MM*mm, MAT_MM*mm
    inset = rail+mat
    c=canvas.Canvas(str(pdf), pagesize=(w,h), pageCompression=1)
    c.setTitle('Garden — A4 / equal 12 mm mat')
    c.setFillColorRGB(0.974,0.970,0.952)
    c.rect(0,0,w,h,stroke=0,fill=1)
    # Clip the generated oak source to a ring with exactly 6 mm rails.
    c.saveState()
    ring=c.beginPath();ring.rect(0,0,w,h);ring.rect(rail,rail,w-2*rail,h-2*rail)
    c.clipPath(ring,stroke=0,fill=0,fillMode=0)
    c.drawImage(str(wood_source),0,0,width=w,height=h,mask='auto')
    c.restoreState()
    # A single inset defines all four blank mat bands; there is no footer.
    c.drawImage(str(artwork),inset,inset,width=w-2*inset,height=h-2*inset,mask='auto')
    c.showPage();c.save()
    doc=fitz.open(pdf)
    page=doc[0]
    assert abs(page.rect.width/mm-210)<0.001 and abs(page.rect.height/mm-297)<0.001
    target_w,target_h=2480,3508
    pix=page.get_pixmap(matrix=fitz.Matrix(target_w/page.rect.width,target_h/page.rect.height),alpha=False)
    pix.set_dpi(300,300);pix.save(png)
    source_size=ImageReader(str(artwork)).getSize()
    spec=layout_spec()
    spec.update(pdf=pdf.name,png=png.name,pixels=[pix.width,pix.height],
                artwork_source=Path(os.path.relpath(artwork.resolve(), destination.resolve())).as_posix(),
                wood_source=Path(os.path.relpath(wood_source.resolve(), destination.resolve())).as_posix(),
                source_pixels=list(source_size),source_aspect_ratio=source_size[0]/source_size[1],
                image_sha256=hashlib.sha256(png.read_bytes()).hexdigest(),
                verification='A4 MediaBox checked; artwork inset 18 mm minus wood inset 6 mm = 12 mm on all four sides. PNG boundaries quantized to pixels at 300 dpi.')
    (destination/'layout_A4.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
    doc.close()
    return spec

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('artwork');p.add_argument('wood_source');p.add_argument('destination')
    a=p.parse_args();print(json.dumps(render(a.artwork,a.wood_source,a.destination),ensure_ascii=False,indent=2))
