"""Reconstruct a pristine static pen from the owner's reference; retain the supplied source files."""
import bpy
import bmesh
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parent.parent
model_dir = root / 'models' / 'pen'
spec = json.loads((model_dir / 'specification.json').read_text())
source_dir = model_dir / 'source'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if args:
    incoming = Path(args[0]).resolve()
    source_dir.mkdir(parents=True, exist_ok=True)
    for source in incoming.iterdir():
        if not source.is_file() or source.suffix.lower() not in {'.fbx', '.png'}:
            continue
        target = source_dir / source.name
        if target.exists() and hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
            raise RuntimeError(f'Refusing to replace a different source: {target.name}')
        if not target.exists():
            shutil.copy2(source, target)
fbx = next(source_dir.glob('*.fbx'))
source_files = [fbx, *sorted(source_dir.glob('*.png'))]
assert len(source_files) == 5, 'Expected the FBX and four original PBR maps'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(fbx))
source_meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
source_triangles = sum(len(obj.data.polygons) for obj in source_meshes)
straighten = Matrix.Rotation(-math.pi / 4, 4, 'Y')
source_points = [straighten @ (obj.matrix_world @ vertex.co) for obj in source_meshes for vertex in obj.data.vertices]
source_length = max(point.z for point in source_points) - min(point.z for point in source_points)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

length = spec['lengthMm'] / 1000
radius = spec['bodyDiameterMm'] / 2000
circumference_mm = math.pi * spec['bodyDiameterMm']
parts = []

def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    return mat

black = material('CleanBlackLacquer', (.013, .014, .016), .2, .24)
chrome = material('PolishedChrome', (.72, .76, .8), 1, .18)
point_metal = material('WritingPoint', (.25, .23, .19), .85, .27)
laser = material('LASER_ENGRAVING', (1, 1, 1), .65, .4)
laser.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = 0
laser.surface_render_method = 'DITHERED'

# Profiles are in millimetres along the pen, before laying it down.
def lathe(name, profile, mat, segments=128):
    vertices = []
    for z_mm, r_mm in profile:
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            z = z_mm(angle) if callable(z_mm) else z_mm
            vertices.append((r_mm / 1000 * math.cos(angle), r_mm / 1000 * math.sin(angle), z / 1000))
    faces = []
    for row in range(len(profile) - 1):
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((row * segments + segment, row * segments + following,
                          (row + 1) * segments + following, (row + 1) * segments + segment))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for face in mesh.polygons:
        face.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    parts.append(obj)
    return obj

r = radius * 1000
seam = lambda angle: 120 + 2.5 * math.cos(angle)
body = lathe('BlackBarrel', [(21.2, 0), (21.2, r - .35), (21.4, r - .15),
    (24, r - .1), (34, r), (72, r), (115, r), (seam, r), (seam, 0)], black)
lathe('ChromeTip', [(0.7, .45), (1.5, .7), (2.0, .9), (19.7, r - .45),
    (20.8, r - .35), (21.2, r - .35), (21.2, 0)], chrome)
lathe('BallPoint', [(0, 0), (.05, .18), (.35, .35), (.8, .42), (1.5, .45)], point_metal, 64)
for center in (53.5, 58.5, 63.5):
    lathe('ChromeRing', [(center - .6, r - .03), (center - .5, r + .07),
        (center - .35, r + .11), (center + .35, r + .11),
        (center + .5, r + .07), (center + .6, r - .03)], chrome)
lathe('ChromeCap', [(seam, 0), (seam, r - .04), (137.5, r - .04),
    (138, r - .08), (138.2, 0)], chrome)
lathe('BlackButtonRim', [(137.9, 0), (137.9, r), (138.1, r + .12),
    (139.0, r + .12), (139.2, r), (139.2, 0)], black)
lathe('ChromeButton', [(139.0, 0), (139.0, r - .14), (139.6, r - .14),
    (139.9, r - .35), (140, r - .6), (140, 0)], chrome)

# Flat spring clip: a closed strip with a real gap above the barrel and a rounded toe.
outline = [(-r + .1, 136.7), (-r - 1.0, 137.0), (-r - 2.5, 135.5),
    (-r - 2.8, 132.5), (-r - 2.8, 110), (-r - 2.5, 106),
    (-r - 1.4, 103), (-r - .8, 102.5), (-r - .45, 103),
    (-r - 1.6, 107), (-r - 1.9, 111), (-r - 1.9, 131.8),
    (-r - 1.5, 133.5), (-r + .1, 134)]
n = len(outline)
vertices = [(x / 1000, y, z / 1000) for y in (-.0014, .0014) for x, z in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
mesh = bpy.data.meshes.new('CleanClip')
mesh.from_pydata(vertices, [], faces)
mesh.update()
normals = bmesh.new()
normals.from_mesh(mesh)
bmesh.ops.recalc_face_normals(normals, faces=list(normals.faces))
normals.to_mesh(mesh)
normals.free()
clip = bpy.data.objects.new('CleanClip', mesh)
bpy.context.collection.objects.link(clip)
clip.data.materials.append(chrome)
parts.append(clip)
bpy.context.view_layer.objects.active = clip
clip.select_set(True)
# Two clean manufacturing notches near the top, matching the supplied photograph.
for z in (133.5, 135.5):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-(r + 1.5) / 1000, .00145, z / 1000))
    cutter = bpy.context.object
    cutter.dimensions = (.004, .0012, .0009)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.objects.active = clip
    modifier = clip.modifiers.new('ClipNotch', 'BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.object = cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
bevel = clip.modifiers.new('RoundedManufacturedEdges', 'BEVEL')
bevel.width = .00017
bevel.segments = 4
bpy.ops.object.modifier_apply(modifier=bevel.name)
for face in clip.data.polygons:
    face.use_smooth = True
weighted = clip.modifiers.new('PlanarMetalNormals', 'WEIGHTED_NORMAL')
bpy.ops.object.modifier_apply(modifier=weighted.name)

bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = 'PEN_BODY'
body.data.name = 'CleanPenBody'

# A curved 40 x 6 mm surface replaces the old YOUR LOGO location.
zone = next(zone for zone in spec['zones'] if zone['id'] == spec['defaultZone'])
print_angle = math.radians(spec['printAngleDeg'])
u_steps, v_steps = 32, 32
vertices = []
uv_values = []
for u_index in range(u_steps + 1):
    z = (zone['centerLengthMm'] - zone['widthMm'] / 2 + zone['widthMm'] * u_index / u_steps) / 1000
    for v_index in range(v_steps + 1):
        angle = print_angle + (v_index / v_steps - .5) * zone['heightMm'] / 1000 / radius
        vertices.append(((radius + .000015) * math.cos(angle), -(radius + .000015) * math.sin(angle), z))
        uv_values.append((z / length, .5 + (angle - print_angle) / (2 * math.pi)))
faces = []
for u_index in range(u_steps):
    for v_index in range(v_steps):
        a = u_index * (v_steps + 1) + v_index
        b = a + v_steps + 1
        faces.append((a, b, b + 1, a + 1))
mesh = bpy.data.meshes.new('PenFixedEngravingUV')
mesh.from_pydata(vertices, [], faces)
mesh.update()
uv = mesh.uv_layers.new(name='PRINT_UV')
for face in mesh.polygons:
    face.use_smooth = True
    for loop_index, vertex_index in zip(face.loop_indices, face.vertices):
        uv.data[loop_index].uv = uv_values[vertex_index]
overlay = bpy.data.objects.new(spec['printMeshName'], mesh)
bpy.context.collection.objects.link(overlay)
overlay.data.materials.append(laser)
overlay['lab_print_overlay'] = True
overlay['surface_width_mm'] = spec['lengthMm']
overlay['surface_height_mm'] = circumference_mm

# Lying on the floor, projected from lower left to upper right in the default view.
pose = Matrix.Rotation(math.radians(spec['poseYawDeg']), 4, 'Z') @ Matrix.Rotation(math.radians(89.55), 4, 'Y')
for obj in (body, overlay):
    for vertex in obj.data.vertices:
        vertex.co = pose @ (vertex.co - Vector((0, 0, length / 2)))
    obj.data.update()
minimum_z = min(vertex.co.z for vertex in body.data.vertices)
for obj in (body, overlay):
    for vertex in obj.data.vertices:
        vertex.co.z -= minimum_z
    obj.data.update()

output_dir = root / 'public' / 'models' / 'pen'
output_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
overlay.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(model_dir / 'prepared.blend'))
bpy.ops.export_scene.gltf(filepath=str(output_dir / 'pen.glb'), use_selection=True,
    export_format='GLB', export_yup=True, export_apply=True, export_extras=True)
body.data.calc_loop_triangles()
overlay.data.calc_loop_triangles()
geometry = {
    'glbSha256': hashlib.sha256((output_dir / 'pen.glb').read_bytes()).hexdigest(),
    'lengthMm': spec['lengthMm'], 'sourceLengthM': source_length,
    'bodyDiameterMm': spec['bodyDiameterMm'], 'circumferenceMm': round(circumference_mm, 6),
    'sourceTriangles': source_triangles, 'bodyTriangles': len(body.data.loop_triangles),
    'printTriangles': len(overlay.data.loop_triangles),
    'sourceHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files},
    'derivation': 'clean geometry and procedural PBR materials reconstructed from owner reference; original FBX and maps retained separately',
    'referenceSha256': hashlib.sha256((model_dir / 'reference.png').read_bytes()).hexdigest(),
    'canonicalFrame': 'glTF Y up; pen rests on XZ plane; default view projects tip bottom-left, button top-right',
    'printSurface': {'widthMm': spec['lengthMm'], 'heightMm': round(circumference_mm, 6), 'axis': 'U along pen; V around barrel'},
}
(model_dir / 'geometry.json').write_text(json.dumps(geometry, indent=2) + '\n')
print('PEN_PREPARED ' + json.dumps({key: value for key, value in geometry.items() if key != 'sourceHashes'}))
