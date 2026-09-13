"""A4 document geometry and the organic annotation art direction."""
PAGE_MM = (210.0, 297.0)
WOOD_MM = 6.0
MAT_MM = 12.0
LAYOUT_VERSION = 'a4-oak6-mat12-organic-v1'

def layout_spec():
    inset = WOOD_MM + MAT_MM
    return {'version': LAYOUT_VERSION, 'page_mm': list(PAGE_MM),
            'wood_mm': WOOD_MM, 'mat_mm': dict.fromkeys(['top','bottom','left','right'], MAT_MM),
            'artwork_rect_mm': [inset,inset,PAGE_MM[0]-2*inset,PAGE_MM[1]-2*inset],
            'footer_text': False, 'raster_dpi': 300}

def annotation_instruction(brief):
    anchors = '; '.join(f"{g['id']} / {g['motif']}: {g['meaning']}" for g in brief['geometry'])
    return ('Add an Organic Data Annotation Overlay within the painting only. Preserve the original palette, '
            'texture and geometry. Use 5–7 hairline charcoal/ivory organic curves with occasional branches; '
            'anchor each leader to an actual geometry corner, rim or texture transition with a tiny dot or hollow circle. '
            'Add around 9–12 micro annotations, a few dark slender pill tags and small unboxed monospaced words. '
            'Choose short readable labels that reflect these objects and their emotional relationships: '+anchors+'. '
            'Use a broken ellipse, a few short ticks and coordinate crosses sparingly. Asymmetric density, '
            'small tags, flat ink lines, no thick ropes, neon HUD or large panels. Do not invent numerical measurements. '
            'Keep labels away from outer picture edges. All labels are artistic interpretations, not measurements. '
            'No bottom question, title or signature; the separate mounting card must remain completely blank.')
