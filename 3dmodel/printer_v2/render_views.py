"""Render useful reference and construction views from the saved master."""
import bpy, sys, json
from pathlib import Path
OUT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(OUT/'printer_atelier.blend'))
s=bpy.context.scene
s.cycles.samples=64
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'; prefs.get_devices()
    for device in prefs.devices: device.use=device.type=='METAL'
    s.cycles.device='GPU' if any(d.type=='METAL' for d in prefs.devices) else 'CPU'
except Exception: s.cycles.device='CPU'
s.render.resolution_x=1400; s.render.resolution_y=1500
names=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['front','detail','rear']
mapping={'hero':'01 • hero','front':'02 • front','rear':'03 • rear','detail':'04 • transport detail'}
for name in names:
    s.camera=bpy.data.objects[mapping[name]]
    s.render.filepath=str(OUT/f'preview_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('VIEW_COMPLETE',name,flush=True)
# Evaluate every model object rather than relying on modifier-free bounds.
deps=bpy.context.evaluated_depsgraph_get()
bad=[]; vertices=0; faces=0
for o in bpy.data.collections['PRINTER • assembly'].all_objects:
    if o.type not in {'MESH','CURVE','FONT'}: continue
    ob=o.evaluated_get(deps); me=ob.to_mesh()
    vertices+=len(me.vertices); faces+=len(me.polygons)
    if not me.vertices: bad.append(o.name)
    ob.to_mesh_clear()
(OUT/'geometry_validation.json').write_text(json.dumps({'evaluated_vertices':vertices,'evaluated_faces':faces,'empty_geometry':bad},indent=2))
