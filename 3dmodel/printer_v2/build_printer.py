"""Reference-led desktop printer, modeled in millimeters; Blender 5.x.
Run with Blender --background --python build_printer.py. Original assets untouched.
"""
import bpy, math, json, os
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
S = .001
def vec(x): return tuple(a*S for a in x)
# This script runs in a new background process, never in the user's active scene.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.length_unit='MILLIMETERS'
model=bpy.data.collections.new('PRINTER • assembly'); scene.collection.children.link(model)
stage=bpy.data.collections.new('STUDIO • cameras and lighting'); scene.collection.children.link(stage)
groups={}
def group(name):
    c=bpy.data.collections.new(name); model.children.link(c); groups[name]=c; return c
shell=group('01 • formed acrylic panels')
frame=group('02 • machined metal chassis')
mechanism=group('03 • feed rollers and print mechanism')
hardware=group('04 • fasteners and controls')
paper=group('05 • continuous paper path')
detail=group('06 • engraved linework')
def link(o,c):
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o)
def mat(name,color,metal=0,rough=.4,trans=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    p.inputs['Transmission Weight'].default_value=trans; p.inputs['IOR'].default_value=1.49
    return m
ivory=mat('Acrylic | warm opal • 3 mm',(0.91,.82,.68),rough=.19,trans=.89)
pink=mat('Acrylic | pale rose • 3 mm',(.89,.58,.54),rough=.18,trans=.93)
hoodmat=mat('Acrylic | satin transparent hood',(.94,.86,.75),rough=.145,trans=.97)
clear=mat('Acrylic | polished edges',(.95,.89,.76),rough=.13,trans=.95)
metal=mat('Metal | satin champagne aluminium',(.65,.56,.43),metal=.78,rough=.32)
silver=mat('Metal | brushed silver',(.64,.67,.64),metal=.86,rough=.27)
brass=mat('Metal | warm brass fasteners',(.48,.31,.14),metal=.78,rough=.3)
cream=mat('Ceramic coating | warm porcelain',(.88,.83,.71),rough=.37)
rubber=mat('Rubber | warm graphite',(.058,.049,.043),rough=.71)
ink=mat('Engraving | sepia fine line',(.24,.15,.11),metal=.12,rough=.63)
rose=mat('Enamel | dusty rose',(.64,.30,.28),rough=.44)
sage=mat('PCB | pale sage',(.27,.38,.30),rough=.57)
white=mat('Paper | natural uncoated cotton',(.93,.875,.755),rough=.84)
floor=mat('Backdrop | warm vellum',(.79,.72,.60),rough=.89)
# Physical fine-scale texture, restrained so the shell still reads as acrylic.
for m,scale,strength,distance in [(ivory,1550,.14,.000028),(pink,1400,.12,.000022),
                                    (white,4800,.25,.000035),(cream,1800,.12,.00002)]:
    n=m.node_tree.nodes; l=m.node_tree.links; p=n.get('Principled BSDF')
    noise=n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=scale
    noise.inputs['Detail'].default_value=2
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=strength
    bump.inputs['Distance'].default_value=distance
    l.new(noise.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
def finish(o,name,m,c,bevel=0):
    o.name=name; link(o,c)
    if m: o.data.materials.append(m)
    if bevel:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=bevel*S; mod.segments=4
    if o.type=='MESH':
        for p in o.data.polygons: p.use_smooth=True
        mod=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    return o
def box(name,loc,dims,m,c=frame,b=1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=vec(loc)); o=bpy.context.object
    o.dimensions=vec(dims); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,m,c,b)
def cyl(name,loc,r,depth,m,c=mechanism,axis='X',b=.3,vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r*S,depth=depth*S,location=vec(loc))
    o=bpy.context.object
    if axis=='X': o.rotation_euler[1]=math.pi/2
    if axis=='Y': o.rotation_euler[0]=math.pi/2
    return finish(o,name,m,c,b)
def line(name,points,m=ink,r=.13,c=detail,closed=False):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.resolution_u=12
    cu.bevel_depth=r*S; cu.bevel_resolution=2
    sp=cu.splines.new('POLY'); sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points): p.co=(*vec(co),1)
    sp.use_cyclic_u=closed
    o=bpy.data.objects.new(name,cu); c.objects.link(o); cu.materials.append(m); return o
def screw(x,y,z,axis='Y',r=1.75):
    cyl('Countersunk brass fixing', (x,y,z),r,.8,brass,hardware,axis,b=.2,vertices=32)
    if axis=='Y':
        box('Slotted screw recess',(x,y-.46,z),(r*1.3,.16,.29),rubber,hardware,b=.09)
    elif axis=='X':
        box('Slotted screw recess',(x+.46,y,z),(.16,r*1.3,.29),rubber,hardware,b=.09)
    else: box('Slotted screw recess',(x,y,z+.46),(r*1.3,.29,.16),rubber,hardware,b=.09)
def mesh(name,verts,faces,m,c,thick=0,b=0):
    me=bpy.data.meshes.new(name); me.from_pydata([vec(v) for v in verts],[],faces); me.update()
    o=bpy.data.objects.new(name,me); c.objects.link(o); me.materials.append(m)
    if thick:
        mod=o.modifiers.new('Real material thickness','SOLIDIFY'); mod.thickness=thick*S; mod.offset=0
    if b:
        mod=o.modifiers.new('Polished edge','BEVEL'); mod.width=b*S; mod.segments=3
    for p in me.polygons: p.use_smooth=True
    return o
def ribbon(name,path,width,m,c,thick=.22):
    vs=[]
    for y,z in path: vs.extend([(-width/2,y,z),(width/2,y,z)])
    return mesh(name,vs,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(path)-1)],m,c,thick)
def text(name,body,loc,size=3,m=ink,rotation=(90,0,0),c=detail):
    cu=bpy.data.curves.new(name,'FONT'); cu.body=body; cu.size=size*S; cu.align_x='CENTER'
    cu.extrude=.007*S; o=bpy.data.objects.new(name,cu); c.objects.link(o); cu.materials.append(m)
    o.location=vec(loc); o.rotation_euler=[math.radians(v) for v in rotation]; return o

# Base is layered, with a readable seam and four elastomer feet.
box('Lower opal acrylic base',(0,0,17),(236,180,25),ivory,shell,9)
box('Continuous lower gasket',(0,0,29),(227,173,1.4),rubber,frame,.6)
box('Champagne chassis pan',(0,0,32),(225,171,4),metal,frame,5)
box('Inset warm porcelain deck',(0,-6,36),(205,153,3),cream,frame,4)
for x in [-91,91]:
    for y in [-65,65]:
        cyl('Silicone vibration isolator',(x,y,3),10,6,rubber,hardware,'Z',1)
        screw(x,y,38,'Z')
# U-shaped rear feed tower. Broad plates echo the front-on reference.
for side in [-1,1]:
    x=side*95
    box('Rear upright • rose acrylic',(x,61,158),(43,6,167),pink,shell,5)
    box('Upright edge return',(side*115,70,141),(4,24,132),ivory,shell,2)
    box('Paper guide rail',(side*73.5,55.8,178),(2.1,3.2,126),silver,frame,.7)
    box('Rear aluminium spine',(side*96,65.5,153),(17,2,145),silver,frame,2)
    for z in [86,141,230]: screw(x,57.4,z)
    for z in [161,213]:
        line('Short guide registration',[(side*71.8,52.8,z),(side*68.3,52.8,z)],metal,.22)
box('Feed tower cross member',(0,63,98),(192,11,7),metal,frame,2)
box('Feed entry shadow',(0,54,122),(146,7,4),rubber,mechanism,1.8)
box('Feed lower polished lip',(0,50.5,119),(146,3,2),silver,frame,.9)
feedpath=[(57+5*(i/40)**2,122+126*(i/40)) for i in range(41)]
ribbon('Blank input paper',feedpath,141,white,paper,.23)
# Low side walls and the front structural opening.
for side in [-1,1]:
    x=side*114
    box('Acrylic side cheek',(x,-4,80),(5,163,94),ivory,shell,3)
    box('Front lower upright',(side*99,-72,58),(13,13,44),cream,frame,2)
    box('Front print bridge attachment',(side*94,-68,92),(17,12,7),metal,frame,1)
    for y in [-61,48]:
        cyl('Metal shell standoff',(side*108,y,53),3.3,9,metal,hardware,'X')
    for z in [47,108]: screw(side*117,-60,z,'X')
# Visible paper roll and roller end hubs under the hood.
cyl('Paper supply roll',(0,14,104),36,155,white,mechanism,b=.7,vertices=128)
cyl('Axle through paper roll',(0,14,104),5,204,silver,mechanism)
for side in [-1,1]:
    cyl('Paper spool rose end flange',(side*80,14,104),37.5,3,pink,mechanism,b=.8,vertices=128)
    cyl('Core bearing',(side*89,14,104),9,12,metal,mechanism)
    cyl('Roll core sleeve',(side*80.1,14,104),10.3,3.4,cream,mechanism)
    # Fine concentric paper layers on each end cap.
    for radius in [13,17,22,28,33,35.6]:
        pts=[(side*81.8,14+radius*math.cos(t*math.tau/128),104+radius*math.sin(t*math.tau/128)) for t in range(128)]
        line('Paper winding edge',pts,metal,.055,mechanism,True)
    box('Roll bearing mount',(side*94,14,79),(8,26,56),metal,frame,3)
    screw(side*94,0.5,84)
# Swept acrylic hood: a real thin sheet, not a transparent solid block.
profile=[]
for i in range(65):
    t=math.pi*i/64
    profile.append((-8-72*math.cos(t),100+47*math.sin(t)))
ribbon('Thermoformed opal acrylic hood',profile,220,hoodmat,shell,3)
for x in [-110,110]:
    line('Polished hood edge',[(x,y,z) for y,z in profile],clear,.8,shell)
    line('Warm metal hood edge binding',[(x,y,z+.25) for y,z in profile],metal,.22,detail)
box('Hood front edge',(0,-80,100),(216,3.2,3),clear,shell,1.4)
for x in [-104,104]: screw(x,-81.8,103,r=1.3)
# Hinge knuckles, steel pins, release latches.
for x in [-95,95]:
    cyl('Hood hinge pin',(x,60,102),2.2,22,silver,hardware)
    for dx in [-7,0,7]: cyl('Hinge barrel',(x+dx,60,102),3.7,5.6,metal,hardware)
    box('Rose release latch',(x,-64,96),(14,18,3),rose,hardware,1.8)
# Front print transport: two rollers, head, springs, gears and cutter.
cyl('Platen rubber roller',(0,-58,69),8,175,rubber,mechanism,b=.6,vertices=128)
cyl('Platen steel axle',(0,-58,69),2.8,213,silver,mechanism)
cyl('Idler transport roller',(0,-32,82),5,164,cream,mechanism)
box('Thermal printhead housing',(0,-50,82),(165,18,12),silver,mechanism,2)
box('Thermal ceramic element',(0,-60,77),(143,2,2.6),cream,mechanism,.5)
for x in range(-76,77,4): box('Printhead heatsink fin',(x,-47,88),(1.1,13,5),metal,mechanism,.3)
for x in [-65,65]:
    pts=[]
    for i in range(241):
        t=i/240
        pts.append((x+3.3*math.cos(t*math.tau*8),-47+3.3*math.sin(t*math.tau*8),86+12*t))
    line('Printhead compression spring',pts,silver,.48,mechanism)
box('Front cutting bar',(0,-78,79),(190,4,3),metal,mechanism,.8)
for i in range(95):
    x=-94+i*2
    mesh('Micro serrated cutter tooth',[(x,-80,79),(x+1,-81.4,77.7),(x+2,-80,79)],[(0,1,2)],silver,mechanism,.35)
for side in [-1,1]:
    cyl('Platen bearing',(side*91,-58,69),11,7,metal,mechanism)
    cyl('Bearing graphite seal',(side*95,-58,69),6.4,.6,rubber,mechanism,b=.2)
    screw(side*105,-73,70)
# One precise toothed drive gear, a smaller motor pulley and belt.
def gear(name,x,y,z,r,teeth):
    verts=[]; faces=[]; N=teeth*4
    for xx in [x-2,x+2]:
        for i in range(N):
            rad=r if i%4 in [1,2] else r-1.6
            a=i*math.tau/N; verts.append((xx,y+rad*math.cos(a),z+rad*math.sin(a)))
    faces.extend([tuple(reversed(range(N))),tuple(range(N,2*N))])
    faces.extend([(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)])
    mesh(name,verts,faces,cream,mechanism,b=.15)
gear('Platen drive gear',100,-58,69,13,28)
gear('Motor pinion',100,-33,57,8,16)
cyl('Stepper motor',(94,-18,56),14,21,silver,mechanism)
box('Motor connector',(88,-1,55),(10,7,6),rubber,mechanism,1)
# Electronics seen softly through the side walls, with traces and wiring.
box('Controller PCB',(0,20,42),(110,70,1.6),sage,mechanism,2)
for x in [-45,45]:
    for y in [-8,47]:
        cyl('PCB mounting standoff',(x,y,39),2,5,brass,hardware,'Z')
        screw(x,y,43.2,'Z',1.2)
box('Controller IC',(0,13,46),(17,17,4),rubber,mechanism,.5)
for i in range(12):
    x=-8+i*1.5
    for y in [3,23]: box('IC gullwing contact',(x,y,44),(0.6,4,.6),silver,mechanism,.1)
for x in [24,34,44]: cyl('Capacitor',(x,31,48),3,9,metal,mechanism,'Z',.5)
for x in range(-40,41,8):
    line('PCB etched trace',[(x,-9,43),(x,2,43),(x+3,5,43),(x+3,31,43)],brass,.16,mechanism)
for j,m in enumerate([rose,cream,rubber]):
    line('Harness cable',[(56+j,28,44),(71+j,32,47),(82+j,17,50),(86+j,-5,57)],m,.75,mechanism)
# Tapering output paper smoothly leaves the roller and curves down, then lifts at tip.
path=[]
for i in range(101):
    t=i/100
    y=-59-141*t
    z=69-61*(3*t*t-2*t*t*t)+3*t**10
    path.append((y,z))
ribbon('Blank output paper • continuous curve',path,136,white,paper,.23)
# A fine raised rim for paper support inside the machine.
box('Paper guide support',(0,-68,49),(148,16,3),cream,frame,1)
for x in [-76,76]: box('Paper guide side fence',(x,-63,55),(2,29,14),metal,frame,.8)
# Controls from the photo: brass ring above horizontal dark window.
cyl('Control bezel',(95,55.8,187),4.3,1.5,brass,hardware,'Y',.5)
cyl('Ivory feed button',(95,54.8,187),2.8,1.3,cream,hardware,'Y',.5)
box('Status window',(95,55.8,164),(30,1.3,5.5),rubber,hardware,2)
box('Amber status indicator',(84,55,164),(3,.4,1),brass,hardware,.4)
text('Feed control legend','FEED',(95,55,176),2.1)
# Restrained scientific-plate marks and fine linework, without illustration on paper.
for side in [-1,1]:
    for i in range(9):
        y=-34+i*6
        line('Side cooling slot',[(side*117.1,y,45),(side*117.1,y,58)],ink,.5)
for x in [-108,108]:
    line('Front shell engraving',[(x,-88,13),(x,-88,23)],ink,.1)
# Rear ports and screw-attached service cover make the model complete from all sides.
box('Rear service panel',(0,90,62),(149,2.2,49),metal,frame,4)
for x in [-67,67]:
    for z in [43,81]:
        cyl('Rear service screw',(x,91.6,z),1.7,.7,brass,hardware,'Y')
box('USB-C recessed socket',(30,91.4,56),(10,1.5,4),rubber,hardware,1.5)
box('USB-C tongue',(30,92.2,56),(6,.7,1),silver,hardware,.4)
cyl('DC inlet rim',(-32,92,56),4.8,2,brass,hardware,'Y')
cyl('DC inlet recess',(-32,93.2,56),3.4,.5,rubber,hardware,'Y')
cyl('DC centre pin',(-32,93.7,56),.8,.8,silver,hardware,'Y')
for i in range(15): box('Rear ventilation slot',(-49+i*7,91.4,73),(3,1,1.4),rubber,hardware,.6)

# Product studio: soft asymmetric light reveals acrylic thickness and metal edges.
box('Seamless ground',(0,0,-4),(20000,20000,2),floor,stage,0)
world=bpy.data.worlds.new('Warm studio environment'); scene.world=world; world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.81,.87,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35
def area(name,loc,power,size,color,target=(0,0,90)):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size*S; data.color=color
    o=bpy.data.objects.new(name,data); stage.objects.link(o); o.location=vec(loc)
    o.rotation_euler=(Vector(vec(target))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key • silk softbox',(-330,-280,500),7,380,(1,.88,.73))
area('Rim • long acrylic reflection',(220,130,390),10,270,(1,.94,.84))
area('Fill • cool silver',(300,-200,220),4,280,(.79,.87,1))
def camera(name,loc,target,ortho):
    d=bpy.data.cameras.new(name); o=bpy.data.objects.new(name,d); stage.objects.link(o)
    o.location=vec(loc); o.rotation_euler=(Vector(vec(target))-o.location).to_track_quat('-Z','Y').to_euler()
    d.type='ORTHO'; d.ortho_scale=ortho*S; d.lens=65; d.clip_start=.001; d.clip_end=50
    return o
hero=camera('01 • hero',(365,-505,335),(0,-25,121),422)
front=camera('02 • front',(0,-600,330),(0,-30,125),405)
rear=camera('03 • rear',(360,470,330),(0,5,131),382)
macro=camera('04 • transport detail',(285,-400,217),(18,-46,90),260)
scene.camera=hero
scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.use_denoising=True
scene.cycles.max_bounces=12; scene.cycles.transmission_bounces=8
scene.render.resolution_x=1500; scene.render.resolution_y=1600; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'; prefs.get_devices()
    for d in prefs.devices: d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices): scene.cycles.device='GPU'
except Exception: pass
# Useful initial viewport framing and material preview.
for sc in bpy.data.screens:
    for ar in sc.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=.55
            ar.spaces.active.region_3d.view_location=Vector((0,0,.12))
            ar.spaces.active.clip_start=.001
            ar.spaces.active.shading.color_type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'printer_atelier.blend'))
# Selection-only asset export excludes the studio and cameras.
bpy.ops.object.select_all(action='DESELECT')
for o in model.all_objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'printer_atelier.glb'),export_format='GLB',use_selection=True,export_apply=True)
report={'objects':len(model.all_objects),'collections':{k:len(c.objects) for k,c in groups.items()},
        'nominal_body_mm':[236,180,248],'paper_width_mm':136,'geometry_unit':'meter',
        'reference':'photo/printer.png; photo/猫咪细线罗马数字版/总览.jpg',
        'note':'Appearance model reconstructed from a single front photo; unseen mechanism and rear are designed, not measured engineering data.'}
(OUT/'model_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
scene.render.filepath=str(OUT/'preview_hero.png'); bpy.ops.render.render(write_still=True)
print('PRINTER_BUILD_COMPLETE',flush=True)
