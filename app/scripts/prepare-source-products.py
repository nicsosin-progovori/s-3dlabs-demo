"""Reproducible, metre-scale SOURCE product mockups; no supplied asset is modified.

Blender Z-up is converted to glTF Y-up on export. Each state is a separate
named root with extras. Print surfaces have their own UVs and stable extras;
the browser selects the state, palette and decoration without rebuilding GLB.
"""
import bpy
import hashlib
import json
import math
import sys
from types import SimpleNamespace
import numpy as np
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
PI = math.pi
STATE = None
MATS = {}


def material(name, color, metal=0, rough=.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = rough
    return mat


def pixels_image(name, rgb):
    h, w, _ = rgb.shape
    im = bpy.data.images.new(name, width=w, height=h, alpha=True)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def textile(name, color, coarse=False):
    mat = material(name, color, 0, .91)
    y, x = np.mgrid[0:256, 0:256]
    period = 32 if coarse else 16
    height = (.55 * np.sin(x * 2 * PI / period) ** 6
              + .45 * np.sin(y * 2 * PI / period) ** 6)
    gy, gx = np.gradient(height)
    norm = np.stack((-gx * 1.7, -gy * 1.7, np.ones_like(gx)), axis=-1)
    norm /= np.linalg.norm(norm, axis=-1, keepdims=True)
    image = pixels_image(name + '_WeaveNormal', norm * .5 + .5)
    image.colorspace_settings.name = 'Non-Color'
    nodes = mat.node_tree.nodes
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .7 if coarse else .36
    mat.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
    mat.node_tree.links.new(normal.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
    return mat


def bamboo():
    mat = material('NaturalBamboo', (.58, .37, .19), 0, .58)
    y, x = np.mgrid[0:512, 0:512]
    rng = np.random.default_rng(9431)
    grain = (.018 * np.sin(y * 1.1 + np.sin(x / 71) * 2)
             + .012 * np.sin(y * .21 + np.cos(x / 93))
             + .008 * rng.normal(size=(512, 512)))
    rgb = np.clip(np.array([.66, .44, .245])[None, None, :] + grain[:, :, None], 0, 1)
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = pixels_image('BambooGrain', rgb)
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return mat


def attach(obj, mat=None):
    if mat:
        obj.data.materials.append(mat)
    if STATE:
        obj.parent = STATE
    return obj


def mesh(name, verts, faces, mat, uvs=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    attach(obj, mat)
    for face in data.polygons:
        face.use_smooth = smooth
    if uvs is not None:
        uv = data.uv_layers.new(name='SurfaceUV')
        for face in data.polygons:
            for li, vi in zip(face.loop_indices, face.vertices):
                uv.data[li].uv = uvs[vi]
    return obj


def cube(name, loc, dims, mat, bevel=.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    attach(obj, mat)
    if bevel:
        mod = obj.modifiers.new('SoftManufacturedEdges', 'BEVEL')
        mod.width = bevel
        mod.segments = 4
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('WeightedNormals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def curve(name, points, radius, mat, cyclic=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 3
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    attach(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


def lathe(name, profile, mat, n=128, uv_height=.21):
    verts, faces, uvs = [], [], []
    for z, r in profile:
        for i in range(n + 1):
            theta = (i / n - .5) * 2 * PI
            verts.append((r * math.sin(theta), -r * math.cos(theta), z))
            uvs.append((i / n, z / uv_height))
    for j in range(len(profile) - 1):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    return mesh(name, verts, faces, mat, uvs)


def print_surface(obj, surface):
    obj['print_surface'] = surface
    return obj


def plane(name, center, width, height, mat, surface, facing='front'):
    x, y, z = center
    if facing == 'top':
        verts = [(x-width/2, y+height/2, z), (x+width/2, y+height/2, z),
                 (x+width/2, y-height/2, z), (x-width/2, y-height/2, z)]
    else:
        verts = [(x-width/2, y, z-height/2), (x+width/2, y, z-height/2),
                 (x+width/2, y, z+height/2), (x-width/2, y, z+height/2)]
    faces=[(3,2,1,0)] if facing=='top' else [(0,1,2,3)]
    uvs=[(0,1),(1,1),(1,0),(0,0)] if facing=='top' else [(0,0),(1,0),(1,1),(0,1)]
    return print_surface(mesh(name, verts, faces, mat, uvs, False), surface)


def state(name):
    global STATE
    STATE = bpy.data.objects.new('STATE_' + name, None)
    bpy.context.collection.objects.link(STATE)
    STATE['product_state'] = name
    return STATE


def label(name, text, loc, size, mat, rotation=(0,0,0), parent=None):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = text
    data.size = size
    data.align_x = 'CENTER'
    data.extrude = .000005
    data.resolution_u = 3
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rotation
    attach(obj, mat)
    if parent:
        obj.parent = parent
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


def reset():
    global STATE, MATS
    STATE = None
    # Also remove the hidden presentation states from the previous owned export.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        if collection.name.startswith('STATE_'):
            bpy.data.collections.remove(collection)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    MATS = {
        'steel': material('BrushedStainlessSteel', (.54,.57,.6), 1, .25),
        'dark': material('SoftBlackABS', (.015,.018,.021), .05, .42),
        'rubber': material('Silicone', (.047,.051,.056), 0, .77),
        'overlay': material('TransparentDecoration', (1,1,1), 0, .5),
    }


def export(product, precision, source_name='prepared.blend'):
    path = ROOT / 'models' / product
    output = ROOT / 'public' / 'models' / product / (product + '.glb')
    path.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {}
    bpy.context.view_layer.update()
    for root in [o for o in bpy.context.scene.objects if 'product_state' in o]:
        meshes = [o for o in root.children_recursive if o.type == 'MESH' and 'print_surface' not in o]
        pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
        low = [min(v[i] for v in pts) for i in range(3)]
        high = [max(v[i] for v in pts) for i in range(3)]
        tris = 0
        for o in meshes:
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
        report[root['product_state']] = {
            'boundsMmBlenderXYZ': {'min': [round(v*1000,3) for v in low], 'max': [round(v*1000,3) for v in high]},
            'triangles': tris,
        }
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
        export_yup=True, export_apply=True, export_extras=True, export_cameras=False,
        export_lights=False, export_materials='EXPORT')
    # A readable editable source: one visible state, all variants retained in
    # named collections. Organise after GLB export so every state is exported.
    roots=[o for o in bpy.context.scene.objects if 'product_state' in o]
    for index,root in enumerate(roots):
        collection=bpy.data.collections.new(root.name)
        bpy.context.scene.collection.children.link(collection)
        for obj in [root,*root.children_recursive]:
            for prior in list(obj.users_collection):
                prior.objects.unlink(obj)
            collection.objects.link(obj)
        collection.hide_viewport=index!=0
        collection.hide_render=index!=0
    bpy.ops.wm.save_as_mainfile(filepath=str(path / source_name))
    metadata = {'glbSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                'bytes': output.stat().st_size, 'units': 'metres', 'states': report,'sourceFile':source_name,
                'derivation': precision, 'canonicalFrame': 'glTF Y-up, front +Z, floor Y=0; embedded textures'}
    (path / 'geometry.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print('SOURCE_PRODUCT_READY ' + json.dumps({'product':product, **metadata}))


def bottle():
    # V01 source and asset are retained in models/bottle/versions/v01/.
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from source_bottle import build_bottle
    build_bottle(SimpleNamespace(**globals()))
    return


def strap_ribbon(name, centers, width, mat, thickness=.0014, normal=None):
    # Closed 3D textile ribbon with UVs in physical weave repeats.
    verts, uvs, faces = [], [], []
    for i, p in enumerate(centers):
        p = Vector(p)
        tangent = Vector(centers[min(i+1,len(centers)-1)]) - Vector(centers[max(0,i-1)])
        tangent.normalize()
        if normal == 'floor':
            across = Vector((-tangent.y,tangent.x,0)).normalized()
        else:
            across = Vector((1,0,0)) if normal is None else Vector(normal)
        n = tangent.cross(across).normalized()
        for off, h in ((-width/2,-thickness/2),(width/2,-thickness/2),(width/2,thickness/2),(-width/2,thickness/2)):
            verts.append(tuple(p+across*off+n*h))
            uvs.append((off / .012, i / max(1,len(centers)-1) * 8))
    for i in range(len(centers)-1):
        for j in range(4):
            a=i*4+j; b=i*4+(j+1)%4
            faces.append((a,b,b+4,a+4))
    faces += [(3,2,1,0), tuple(range((len(centers)-1)*4,len(centers)*4))]
    return mesh(name,verts,faces,mat,uvs)


def module_at(transform):
    before=set(bpy.context.scene.objects)
    # Front is a textile band passing through a thin zinc-alloy frame; no screen.
    cube('EndoSensorBody',(0,0,0),(.027,.008,.042),MATS['dark'],.003)
    frame=MATS['frame']
    cube('FrontFrameLeft',(-.0125,-.0042,0),(.002,.0015,.041),frame,.0007)
    cube('FrontFrameRight',(.0125,-.0042,0),(.002,.0015,.041),frame,.0007)
    cube('UpperFrameBridge',(0,-.0042,.0185),(.025,.0015,.005),frame,.001)
    cube('EngravingBar',(0,-.0043,-.018),(.025,.0018,.006),frame,.001)
    band=cube('TextileThroughFrame',(0,-.0047,.001),(.021,.0015,.029),MATS['strap'],.0006)
    # Restore a fine, repeated UV on the visible fabric surface.
    for uv in band.data.uv_layers.active.data:
        uv.uv *= 3
    plane('EndoDecoration',(0,-.00524,-.018),.018,.003,MATS['overlay'],'front')
    sensor=cube('OpticalSensorGlass',(0,.0042,0),(.015,.0008,.016),MATS['glass'],.003)
    for x,z in ((-.003,-.003),(.003,-.003),(0,.003)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.0012,location=(x,.0047,z))
        attach(bpy.context.object,MATS['sensor'])
    for x in (-.003,.003):
        cube('ChargeContact',(x,.0045,-.012),(.0015,.0006,.0015),MATS['contact'],.0003)
    group=bpy.data.objects.new('EndoModuleAssembly',None)
    bpy.context.collection.objects.link(group)
    group.parent=STATE
    for obj in set(bpy.context.scene.objects)-before:
        if obj is not group:
            obj.parent=group
    group.matrix_basis=transform


def tracker_flat(length=.24, z=.004):
    pts=[(-length/2+i/80*length,0,.002) for i in range(81)]
    strap_ribbon('OpenWovenBand',pts,.021,MATS['strap'],normal=(0,1,0))
    module_at(Matrix.Translation((0,0,z)) @ Matrix.Rotation(PI/2,4,'Z') @ Matrix.Rotation(-PI/2,4,'X'))
    # Fold-over hook-and-loop tip and rectangular adjustment hardware.
    cube('HookLoopTab',(-length/2+.016,0,.003),(.032,.021,.0018),MATS['strap'],.003)
    for x in (length/2-.021,length/2-.003):
        cube('StrapBuckleBridge',(x,0,.003),(.002,.026,.003),MATS['frame'],.0006)
    for y in (-.012,.012):
        cube('StrapBuckleSide',(length/2-.012,y,.003),(.020,.002,.003),MATS['frame'],.0006)


def box(opened=False):
    kraft=MATS['kraft']; paper=MATS['paper']; ink=MATS['ink']
    cube('GiftBoxBottom',(0,0,.00065),(.143,.084,.0013),kraft,.0004)
    for x in (-.0708,.0708):
        cube('GiftBoxSide',(x,0,.0085),(.0014,.084,.017),kraft,.0004)
    for y in (-.0413,.0413):
        cube('GiftBoxEnd',(0,y,.0085),(.143,.0014,.017),kraft,.0004)
    if not opened:
        cube('GiftBoxLid',(0,0,.0165),(.143,.084,.0015),kraft,.0006)
        cube('PackagingLabel',(0,-.003,.0173),(.128,.066,.00012),paper,.0001)
        label('BoxTitle','Endo',(0,.009,.0174),.012,ink)
        label('BoxSubtitle','Wearable Health Tracker',(0,.027,.0174),.005,ink)
        label('BoxCaption','24/7  ·  Sleep  ·  Heart rate',(0,-.013,.0174),.004,ink)
        return
    cube('PaperInsert',(0,0,.003),(.137,.078,.004),paper,.002)
    # Reconstructed interior: shallow paper tray, folded wristband, leaflet.
    cube('TrayRecess',(0,0,.0052),(.112,.049,.0004),kraft,.003)
    tracker_flat(.105,.010)
    cube('QuickStartLeaflet',(.043,.026,.0056),(.033,.019,.001),paper,.0003)
    label('LeafletTitle','Endo',(.043,.026,.0062),.004,ink)
    before=set(bpy.context.scene.objects)
    cube('OpenedLid',(0,-.042,.0006),(.143,.084,.0013),kraft,.0005)
    cube('LidInnerPaper',(0,-.042,-.0002),(.130,.070,.0002),paper,.0001)
    hinge=bpy.data.objects.new('OpenBoxHinge',None)
    bpy.context.collection.objects.link(hinge)
    hinge.parent=STATE
    for obj in set(bpy.context.scene.objects)-before:
        if obj is not hinge:
            obj.parent=hinge
    hinge.location=(0,.042,.016)
    hinge.rotation_euler.x=math.radians(-108)


def endo():
    reset()
    MATS['strap']=textile('EndoStrap',(.018,.021,.024),True)
    MATS['frame']=material('EndoFrame',(.023,.027,.033),.58,.36)
    MATS['glass']=material('SensorGlass',(.008,.014,.018),.4,.13)
    MATS['sensor']=material('OpticalSensor',(.1,.24,.15),.25,.2)
    MATS['contact']=material('ChargingContacts',(.55,.4,.15),.8,.3)
    MATS['kraft']=material('RecycledKraft',(.43,.28,.145),0,.9)
    MATS['paper']=material('FSCOffWhitePaper',(.75,.735,.65),0,.95)
    MATS['ink']=material('PackagingInk',(.11,.15,.12),0,.85)
    state('wrist')
    centers=[(0,-.027*math.cos(i/160*2*PI),.039+.037*math.sin(i/160*2*PI)) for i in range(161)]
    strap_ribbon('ClosedWovenBand',centers,.022,MATS['strap'])
    module_at(Matrix.Translation((0,-.028,.039)))
    for z in (.063,.073):
        cube('AdjustmentBuckle',(0,-.019,z),(.025,.003,.003),MATS['frame'],.0007)
    state('flat')
    tracker_flat()
    state('box-closed')
    box(False)
    state('box-open')
    box(True)
    export('endo','SOURCE Endo / P330.9001 photographs; 42 x 27 x 8 mm module and 143 x 84 x 17 mm box. Owner authorizes approximate strap length (240 mm) and reconstructed open-box interior; visual likeness takes priority.')


def pillow_profile(i, n):
    u=(i/n*2-1)
    if abs(u)<=.78:
        return math.radians(u/.78*115), 1
    a=(abs(u)-.78)/.22*PI/2
    return math.copysign(math.radians(115+30*math.sin(a)),u), max(.0001,math.cos(a))


def pillow_body():
    n, m = 128, 48
    verts, uvs, faces = [], [], []
    for i in range(n+1):
        theta,cap=pillow_profile(i,n)
        for j in range(m+1):
            phi=2*PI*j/m
            r=.076+.034*math.cos(phi)*cap
            verts.append((r*math.sin(theta),r*math.cos(theta)*1.12,.0545+.0545*math.sin(phi)*cap))
            uvs.append((i/n*20,j/m*5))
    for i in range(n):
        for j in range(m):
            a=i*(m+1)+j
            faces.append((a,a+1,a+m+2,a+m+1))
    low_y=min(v[1] for v in verts); high_y=max(v[1] for v in verts)
    y_scale=.220/(high_y-low_y)
    verts=[(x,y*y_scale,z) for x,y,z in verts]
    obj=mesh('TwoToneMemoryFoamCover',verts,faces,MATS['pillow-outer'],uvs)
    obj.data.materials.append(MATS['pillow-inner'])
    for face in obj.data.polygons:
        j=face.index % m
        face.material_index=1 if math.cos(2*PI*(j+.5)/m)<0 else 0
    for end in (0,n):
        vs=[verts[end*(m+1)+j] for j in range(m)]
        mesh('SoftEndCap',vs,[tuple(range(m))],MATS['pillow-outer'],smooth=False)
    # Subtle sewn seam and piping at the join of the two fabrics.
    for side in (1,-1):
        pts=[]
        for i in range(3,n-2):
            theta,cap=pillow_profile(i,n)
            pts.append((.076*math.sin(theta),.076*math.cos(theta)*1.12*y_scale,.0545+side*.054*cap))
        curve('CoverPiping',pts,.00045,MATS['piping'])
    # A longitudinal stitch on the grey inner back matches the visible reference.
    theta=0
    pts=[((.076+.034*math.cos(p))*math.sin(theta),(.076+.034*math.cos(p))*1.12*y_scale,.0545+.0545*math.sin(p))
         for p in np.linspace(PI/2,3*PI/2,49)]
    curve('InnerBackSeam',pts,.00018,MATS['piping'])
    return y_scale


def pillow():
    reset()
    MATS['pillow-outer']=textile('PillowBlackPolyester',(.019,.022,.025))
    MATS['pillow-inner']=textile('PillowGreyPolyester',(.23,.25,.26))
    MATS['piping']=material('CoverSeam',(.095,.11,.115),0,.9)
    MATS['strap']=material('PUStraps',(.065,.071,.074),0,.68)
    state('ready')
    y_scale=pillow_body()
    # A fixed curved 80 x 40 mm decoration follows the right outer lobe.
    verts,uvs,faces=[],[],[]
    radius=.076+.034*math.sqrt(1-(.007/.0545)**2)
    for i in range(49):
        a=math.radians(72)+(i/48-.5)*.080/.108
        for j in range(17):
            z=.0545+(j/16-.5)*.040
            r=.076+.034*math.sqrt(max(0,1-((z-.0545)/.0545)**2))+.00006
            verts.append((r*math.sin(a),r*math.cos(a)*1.12*y_scale,z))
            uvs.append((1-i/48,j/16))
    for i in range(48):
        for j in range(16):
            a=i*17+j
            faces.append((a,a+1,a+18,a+17))
    print_surface(mesh('PillowCurvedDecoration',verts,faces,MATS['overlay'],uvs),'side')
    # Silicone controls on the opposite lobe.
    angle=math.radians(-75)
    normal=Vector((math.sin(angle),math.cos(angle),0))
    tangent=Vector((math.cos(angle),-math.sin(angle),0))
    center=Vector((.11*math.sin(angle),.11*math.cos(angle)*1.12*y_scale,.052))
    panel=cube('SiliconeControlPanel',center,(.038,.002,.017),MATS['rubber'],.006)
    panel.rotation_euler.z=-angle
    for off in (-.007,.007):
        pos=center+tangent*off+normal*.0014
        # Fine raised power / mode symbols, rather than a painted screen.
        pts=[tuple(pos+tangent*math.cos(a)*.003+Vector((0,0,math.sin(a)*.003))) for a in np.linspace(.4,2*PI-.4,32)]
        curve('ControlIcon',pts,.00022,MATS['piping'])
    for side in (-1,1):
        pts=[]
        for i in range(49):
            t=i/48
            # Loose PU loop on the floor at either end, as in the product photo.
            pts.append((side*(.052+.067*math.sin(t*PI)), -.062-.067*t, .007+.025*(1-t)**3))
        strap_ribbon('AdjustablePUStrap',pts,.012,MATS['strap'],.0015,normal='floor')
        connection=[(side*(.052-(.052-.016)*i/16),-.129-.003*i/16,.007) for i in range(17)]
        strap_ribbon('BuckleConnection',connection,.012,MATS['strap'],.0015,normal='floor')
    buckle=cube('FrontStrapBuckle',(0,-.132,.008),(.032,.015,.006),MATS['rubber'],.003)
    for x in (-.008,0,.008):
        cube('BuckleSlot',(x,-.132,.011),(.003,.010,.001),MATS['dark'],.001)
    export('pillow','SOURCE MO3154 photographs; body 220 x 220 x 109 mm, two-tone polyester, PU straps and control panel; secondary details reconstructed. Embroidery is an owner-requested additional mockup technique, absent from current SOURCE listing.')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--product',choices=['all','bottle','endo','pillow'],default='all')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for prepare in (bottle,endo,pillow):
        if args.product in ('all',prepare.__name__):prepare()
