"""Actual 3D NPR materials plus variable sepia contour strokes, no image filter."""
import bpy, math, random
from pathlib import Path
OUT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(OUT/'printer_atelier.blend'))
s=bpy.context.scene
s.render.engine='CYCLES'
s.cycles.samples=32
s.cycles.device='CPU'
for light in bpy.data.lights: light.energy *= .06
s.world.node_tree.nodes['Background'].inputs[1].default_value=.15
s.render.resolution_x=1400; s.render.resolution_y=1500
s.render.use_freestyle=True
fs=s.view_layers[0].freestyle_settings
fs.crease_angle=math.radians(125)
ls=fs.linesets[0] if fs.linesets else fs.linesets.new('Visible contours')
ls.show_render=True
ls.select_by_edge_types=True; ls.select_by_visibility=True; ls.visibility='VISIBLE'
ls.select_by_collection=True; ls.collection=bpy.data.collections['PRINTER • assembly']
ls.select_silhouette=True; ls.select_border=True; ls.select_crease=False
if ls.linestyle is None: ls.linestyle=bpy.data.linestyles.new('Sepia technical pen')
style=ls.linestyle; style.color=(.21,.14,.10); style.alpha=.85; style.thickness=1.0
style.caps='ROUND'
try:
    noise=style.geometry_modifiers.new('Subtle pen movement','SPATIAL_NOISE')
    noise.amplitude=.32; noise.scale=18; noise.octaves=2
    thick=style.thickness_modifiers.new('Pen pressure','NOISE')
    thick.amplitude=.23; thick.period=16
except Exception as e: print('Optional stroke variation:',e,flush=True)
# Soft, lightly variegated pigments evaluated on the actual surfaces.
for m in list(bpy.data.materials):
    if not m.use_nodes: continue
    p=m.node_tree.nodes.get('Principled BSDF')
    if not p: continue
    base=list(p.inputs['Base Color'].default_value[:3])
    is_acrylic=m.name.startswith('Acrylic')
    is_metal=m.name.startswith('Metal')
    if is_acrylic:
        base=(.85,.49,.46) if 'rose' in m.name else (.90,.84,.70)
    elif is_metal: base=(.57,.54,.43) if 'silver' not in m.name else (.55,.62,.57)
    elif m.name.startswith('Backdrop'): base=(.88,.81,.65)
    nodes=m.node_tree.nodes; links=m.node_tree.links
    nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial')
    geom=nodes.new('ShaderNodeNewGeometry')
    dot=nodes.new('ShaderNodeVectorMath'); dot.operation='DOT_PRODUCT'
    dot.inputs[1].default_value=(-.38,-.45,.81)
    links.new(geom.outputs['Normal'],dot.inputs[0])
    ramp=nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation='EASE'
    ramp.color_ramp.elements[0].position=-.4
    ramp.color_ramp.elements[0].color=(*(max(0,c*.64) for c in base),1)
    ramp.color_ramp.elements[1].position=.85
    ramp.color_ramp.elements[1].color=(*(min(1,c*1.07) for c in base),1)
    links.new(dot.outputs['Value'],ramp.inputs[0])
    noise=nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=330
    noise.inputs['Detail'].default_value=3; noise.inputs['Roughness'].default_value=.72
    grain=nodes.new('ShaderNodeValToRGB')
    grain.color_ramp.elements[0].color=(.78,.78,.78,1)
    grain.color_ramp.elements[1].color=(1,1,1,1)
    links.new(noise.outputs['Fac'],grain.inputs[0])
    mult=nodes.new('ShaderNodeMixRGB'); mult.blend_type='MULTIPLY'; mult.inputs[0].default_value=.65
    links.new(ramp.outputs['Color'],mult.inputs[1]); links.new(grain.outputs['Color'],mult.inputs[2])
    diffuse=nodes.new('ShaderNodeBsdfDiffuse'); links.new(mult.outputs[0],diffuse.inputs['Color'])
    emission=nodes.new('ShaderNodeEmission'); links.new(mult.outputs[0],emission.inputs['Color'])
    mix=nodes.new('ShaderNodeMixShader'); mix.inputs[0].default_value=.91
    links.new(diffuse.outputs[0],mix.inputs[1]); links.new(emission.outputs[0],mix.inputs[2])
    if is_acrylic:
        transparent=nodes.new('ShaderNodeBsdfTransparent')
        trans=nodes.new('ShaderNodeMixShader'); trans.inputs[0].default_value=.48
        links.new(mix.outputs[0],trans.inputs[1]); links.new(transparent.outputs[0],trans.inputs[2])
        links.new(trans.outputs[0],out.inputs['Surface'])
    else: links.new(mix.outputs[0],out.inputs['Surface'])
# Pen hatching follows actual acrylic surfaces, with repeatable small irregularities.
# This is editable scene geometry, not a screen-space texture over the render.
rng=random.Random(731)
pen=bpy.data.materials.new('NPR | translucent umber pencil'); pen.use_nodes=True
pn=pen.node_tree.nodes; pl=pen.node_tree.links; pn.clear()
po=pn.new('ShaderNodeOutputMaterial'); pe=pn.new('ShaderNodeEmission')
pe.inputs[0].default_value=(.43,.34,.26,1)
pt=pn.new('ShaderNodeBsdfTransparent'); pm=pn.new('ShaderNodeMixShader'); pm.inputs[0].default_value=.72
pl.new(pe.outputs[0],pm.inputs[1]); pl.new(pt.outputs[0],pm.inputs[2]); pl.new(pm.outputs[0],po.inputs[0])
cu=bpy.data.curves.new('Surface pencil hatching','CURVE'); cu.dimensions='3D'; cu.bevel_depth=.00003; cu.bevel_resolution=1
def hatch(points):
    sp=cu.splines.new('POLY'); sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points): p.co=(*(v*.001 for v in co),1)
for side in [-1,1]:
    for i in range(160):
        x=side*rng.uniform(78,112); z=rng.uniform(148,236)
        if side>0 and abs(x-95)<16 and 158<z<198: continue
        length=rng.uniform(.3,1.4)
        hatch([(x,57.8,z),(x+.3,57.72,z+length)])
    for i in range(100):
        x=side*rng.uniform(89,108); t=rng.uniform(.23,1.48)
        y=-8-73.55*math.cos(t); z=100+48.55*math.sin(t)
        hatch([(x,y,z),(x-side*rng.uniform(1,3),y-.15,z+.09)])
for i in range(105):
    y=rng.uniform(-45,46); z=rng.uniform(68,85)
    hatch([(117.6,y,z),(117.63,y+1.2,z+2.4)])
ob=bpy.data.objects.new('Pencil • acrylic surface hatching',cu)
hc=bpy.data.collections.new('NPR • faint pencil strokes'); s.collection.children.link(hc)
hc.objects.link(ob); cu.materials.append(pen)
s.view_settings.view_transform='Standard'
s.view_settings.look='None'
s.render.filepath=str(OUT/'preview_illustrated.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'printer_illustrated.blend'))
bpy.ops.render.render(write_still=True)
print('ILLUSTRATED_COMPLETE',flush=True)
