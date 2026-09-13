from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import numpy as np
from scipy import ndimage

OUT = Path(__file__).resolve().parent
SOURCE = OUT.parent / '粉色统一版/ChatGPT Image 2026年9月12日 17_33_19 (6).png'
base = Image.open(OUT / '01-I.png').convert('RGB')
# Clear only the old illustration with paper taken from the same vertical band.
strip = base.crop((172, 390, 260, 1320))
paper = Image.new('RGB', (616, 930))
for j in range(7):
    paper.paste(strip if j % 2 == 0 else ImageOps.mirror(strip), (88*j, 0))
patch_mask = Image.new('L', base.size, 0)
ImageDraw.Draw(patch_mask).rectangle((280, 400, 750, 1307), fill=255)
patch_mask = patch_mask.filter(ImageFilter.GaussianBlur(4))
paper_layer = base.copy()
paper_layer.paste(paper, (250, 390))
base = Image.composite(paper_layer, base, patch_mask)
# Erase the old I within the otherwise blank label area.
base.paste(base.crop((420, 1310, 484, 1380)), (484, 1310))
source = Image.open(SOURCE).convert('RGB')
a = np.array(source)
ink = ndimage.binary_closing(a[:, :, 1] < 222, iterations=3)
labels, _ = ndimage.label(ink)
sizes = np.bincount(labels.ravel())
sizes[0] = 0
mask = ndimage.binary_fill_holes(labels == sizes.argmax())
mask = ndimage.binary_dilation(mask, iterations=2)
alpha = Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7))
box = alpha.getbbox()
art = source.crop(box)
alpha = alpha.crop(box)
scale = min(548 / art.width, 796 / art.height)
size = (round(art.width * scale), round(art.height * scale))
art = art.resize(size, Image.Resampling.LANCZOS)
alpha = alpha.resize(size, Image.Resampling.LANCZOS)
base.paste(art, ((1024-size[0])//2, 843-size[1]//2), alpha)
draw = ImageDraw.Draw(base)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman.ttf', 58)
draw.text((512, 1347), 'VII', font=font, anchor='mm', fill=(149, 134, 105))
base.save(OUT / '07-VII.png')
print(OUT / '07-VII.png')
