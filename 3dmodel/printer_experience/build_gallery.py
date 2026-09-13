from pathlib import Path
from urllib.parse import urlencode
from html import escape
import json
ROOT=Path(__file__).resolve().parent
style=json.loads((ROOT/'garden_style.json').read_text())
sections=[]
for group,keys in [('AI 花园样张',['garden_default','garden_variant']),('极值差异 · 本地规则草图',['rarity_min','rarity_max'])]:
 cards=''
 for key in keys:
  info=json.loads((ROOT/(key+'.json')).read_text());j=json.loads((ROOT/'jobs'/info['id']/'manifest.json').read_text());p=j['params'];s=j['story'];rr=j['rarity']
  url='/?'+urlencode({k:p[k] for k in ['m','n','a','b','seed']})+'&job='+j['id']
  cards+=f'''<article><a href="{escape(url)}"><img src="{escape(j['image'])}" alt="{escape(s['title'])}"></a><h3>{escape(s['title'])}</h3><small>{escape(rr['label'])} · 合 {rr['sum']} · {rr['ways']}/66（{rr['percent']}%）</small><p>{escape(s['story'])}</p><p class="question">{escape(s['question'])}</p><a class="detail" href="{escape(j['image'])}" target="_blank">查看图像细节 ↗</a> · <a class="detail" href="{escape(url)}">查看动画与手记 ↗</a></article>'''
 sections.append('<h2>'+group+'</h2><section>'+cards+'</section>')
chips=''.join(f'<i style="background:{c}" title="{n}"></i>' for n,c in style['palette'].items())
html='''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>花园 · 色彩、痕迹与故事</title><style>*{box-sizing:border-box}body{margin:0;background:#f5eae2;color:#785f61;font:14px/1.9 -apple-system,"PingFang SC",sans-serif}main{max-width:1120px;margin:50px auto;padding:0 30px}h1{font:43px "Songti SC",serif;margin:12px 0}h2{font:22px "Songti SC",serif;margin-top:45px}header p{max-width:760px;color:#a18783}small{font-size:11px;letter-spacing:.08em;color:#b77f93}section{display:grid;grid-template-columns:1fr 1fr;gap:32px}img{width:100%;display:block}h3{font:24px "Songti SC",serif;margin-bottom:6px}article p{font-size:12px;color:#9b817d}.question{color:#b17c91!important}.palette{display:flex;gap:9px;margin:25px 0}.palette i{width:65px;height:20px}a{color:inherit}.detail{font-size:11px;color:#a5748b}footer{margin:40px 0;border-top:1px solid #dcc4c6;padding-top:20px;font-size:12px;color:#a18382}@media(max-width:650px){section{grid-template-columns:1fr}h1{font-size:32px}}</style><main><header><small>GARDEN / STYLE 1.1 · STORIES WITHIN THE FIELD</small><h1>在颜色里，留下关系的痕迹。</h1><p>粉色与很淡的紫色，约20%的油画感；磨损、剥落、断笔、错位的框架和未闭合的线。不同的卡牌、视角和概率，改变这座花园怎样靠近、怎样保留边界。</p></header><div class="palette">'''+chips+'</div>'+''.join(sections)+'''<footer>3、4、22、23 各有1种抽法（各1/66）；3和23另外承担最小／最大和的极值叙事。概率不等于情感或艺术价值。<p><a href="STORY_RULES.md">数字如何承载故事</a> · <a href="GARDEN_STYLE.md">当前风格尺度</a> · <a href="RARITY.md">概率与差异化</a> · <a href="garden_film.mp4">动画预览</a></p>AI样张为已有画面的配色与细节修订，手记是基于同一输入的策展解读；本地草图用于检验参数差异。在线AI自动调用仍待接入。</footer></main></html>'''
(ROOT/'garden_style.html').write_text(html)
print('Gallery updated')
