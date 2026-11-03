"""Prepare the owner's notebook and conform a fixed print surface to its actual cover."""
import bpy
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parent.parent
model_dir = root / 'models' / 'notebook'
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
paths = {
    'base': source_dir / f'{fbx.stem}.png',
    'normal': source_dir / f'{fbx.stem}_normal.png',
    'roughness': source_dir / f'{fbx.stem}_roughness.png',
    'metallic': source_dir / f'{fbx.stem}_metallic.png',
}
assert all(path.is_file() for path in paths.values()), 'Missing original PBR maps'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(fbx))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert len(meshes) == 1, 'This preparation contract expects one source mesh'
body = meshes[0]
points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
# Native inspection establishes a flat source: X is the long axis, Z is up.
# The bookmark protrudes at -X, so isolate the upper cover when measuring A5.
cover = [point for point in points if point.z > .03]
min_x, max_x = min(point.x for point in cover), max(point.x for point in cover)
min_y, max_y = min(point.y for point in cover), max(point.y for point in cover)
center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
body_points = [point for point in points if min_x <= point.x <= max_x]
base_z = min(point.z for point in body_points)
scale_height = spec['heightMm'] / 1000 / (max_x - min_x)
scale_width = spec['widthMm'] / 1000 / (max_y - min_y)
bookmark_points_adjusted = 0
for vertex, point in zip(body.data.vertices, points):
    z = point.z
    if point.x < min_x and z < base_z:
        z = base_z
        bookmark_points_adjusted += 1
    # Portrait frame: spine left, elastic right, bookmark at the bottom.
    vertex.co = (-(point.y - center_y) * scale_width,
                  (point.x - center_x) * scale_height,
                  (z - base_z) * scale_height)
body.matrix_world.identity()
body.data.update()
body.name = 'NOTEBOOK_BODY'
thickness_mm = (max(point.z for point in body_points) - base_z) * scale_height * 1000

material = bpy.data.materials.new('NOTEBOOK_ORIGINAL')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
bsdf = nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = spec['materialFinish']['roughness']
bsdf.inputs['Metallic'].default_value = spec['materialFinish']['metallic']
for kind, socket in [('base', 'Base Color')]:
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(paths[kind]), check_existing=True)
    texture.image.colorspace_settings.name = 'sRGB' if kind == 'base' else 'Non-Color'
    links.new(texture.outputs['Color'], bsdf.inputs[socket])
normal_texture = nodes.new('ShaderNodeTexImage')
normal_texture.image = bpy.data.images.load(str(paths['normal']), check_existing=True)
normal_texture.image.colorspace_settings.name = 'Non-Color'
normal = nodes.new('ShaderNodeNormalMap')
normal.inputs['Strength'].default_value = spec['materialFinish']['normalStrength']
links.new(normal_texture.outputs['Color'], normal.inputs['Color'])
links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
body.data.materials.clear()
body.data.materials.append(material)

# Project onto the original cover so the print follows its slight surface variation.
bvh = BVHTree.FromPolygons([vertex.co for vertex in body.data.vertices],
    [list(face.vertices) for face in body.data.polygons], all_triangles=True)
zone = next(zone for zone in spec['zones'] if zone['id'] == spec['defaultZone'])
columns, rows = 64, 96
vertices, uvs, source_faces = [], [], set()
upper_z = max(vertex.co.z for vertex in body.data.vertices) + .005
for row in range(rows + 1):
    y = (zone['centerYMm'] - zone['heightMm'] / 2 + zone['heightMm'] * row / rows) / 1000
    for column in range(columns + 1):
        x = (zone['centerXMm'] - zone['widthMm'] / 2 + zone['widthMm'] * column / columns) / 1000
        hit, normal, face_index, distance = bvh.ray_cast(Vector((x, y, upper_z)), Vector((0, 0, -1)), .1)
        assert hit is not None and normal.z > .5, f'Print ray missed the front cover: {x}, {y}'
        assert hit.z > thickness_mm / 1000 * .65, 'Print ray reached the inside/back cover'
        vertices.append((x, y, hit.z + .00006))
        uvs.append((x / (spec['widthMm'] / 1000) + .5, y / (spec['heightMm'] / 1000) + .5))
        source_faces.add(face_index)
faces = []
for row in range(rows):
    for column in range(columns):
        a = row * (columns + 1) + column
        faces.append((a, a + 1, a + columns + 2, a + columns + 1))
mesh = bpy.data.meshes.new('NotebookCoverPrintUV')
mesh.from_pydata(vertices, [], faces)
mesh.update()
uv = mesh.uv_layers.new(name='PRINT_UV')
for polygon in mesh.polygons:
    polygon.use_smooth = True
    for loop_index, vertex_index in zip(polygon.loop_indices, polygon.vertices):
        uv.data[loop_index].uv = uvs[vertex_index]
overlay = bpy.data.objects.new(spec['printMeshName'], mesh)
bpy.context.collection.objects.link(overlay)
overlay['lab_print_overlay'] = True
overlay['surface_width_mm'] = spec['widthMm']
overlay['surface_height_mm'] = spec['heightMm']
print_material = bpy.data.materials.new('DIGITAL_PRINT')
print_material.use_nodes = True
print_bsdf = print_material.node_tree.nodes.get('Principled BSDF')
print_bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
print_bsdf.inputs['Roughness'].default_value = .8
print_bsdf.inputs['Alpha'].default_value = 0
print_material.surface_render_method = 'DITHERED'
overlay.data.materials.append(print_material)

pose = Matrix.Rotation(math.radians(spec['poseYawDeg']), 4, 'Z')
for obj in (body, overlay):
    for vertex in obj.data.vertices:
        vertex.co = pose @ vertex.co
    obj.data.update()

output_dir = root / 'public' / 'models' / 'notebook'
output_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
overlay.select_set(True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(model_dir / 'prepared.blend'))
bpy.ops.export_scene.gltf(filepath=str(output_dir / 'notebook.glb'), use_selection=True,
    export_format='GLB', export_yup=True, export_apply=True, export_extras=True, export_image_format='AUTO')
geometry = {
    'glbSha256': hashlib.sha256((output_dir / 'notebook.glb').read_bytes()).hexdigest(),
    'widthMm': spec['widthMm'], 'heightMm': spec['heightMm'],
    'thicknessMm': round(thickness_mm, 6),
    'sourceCoverDimensions': {'longAxis': max_x - min_x, 'shortAxis': max_y - min_y},
    'scaleFactors': {'heightAndThickness': scale_height, 'width': scale_width},
    'sourceTriangles': len(body.data.polygons), 'printTriangles': len(mesh.polygons) * 2,
    'printProjection': {'widthMm': zone['widthMm'], 'heightMm': zone['heightMm'],
        'offsetMm': .06, 'sampledCoverFaces': len(source_faces)},
    'bookmarkVerticesRaisedToFloor': bookmark_points_adjusted,
    'materialFinish': spec['materialFinish'],
    'sourceMapsUsedInWeb': ['base', 'normal'],
    'sourceHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in [fbx, *paths.values()]},
    'specificationSha256': hashlib.sha256((model_dir / 'specification.png').read_bytes()).hexdigest(),
    'canonicalFrame': 'glTF Y up; notebook lies on floor; spine left, elastic right, bookmark bottom-left in initial view',
}
(model_dir / 'geometry.json').write_text(json.dumps(geometry, indent=2) + '\n')
print('NOTEBOOK_PREPARED ' + json.dumps({key: value for key, value in geometry.items() if key != 'sourceHashes'}))
