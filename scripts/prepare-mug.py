"""Import the owner's FBX without changing it, restore PBR maps and add a cylindrical print surface."""
import bpy
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parent.parent
model_dir = root / 'models' / 'mug'
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
prefix = fbx.stem
paths = {
    'base': source_dir / f'{prefix}.png',
    'normal': source_dir / f'{prefix}_normal.png',
    'roughness': source_dir / f'{prefix}_roughness.png',
    'metallic': source_dir / f'{prefix}_metallic.png',
}
assert all(path.is_file() for path in paths.values()), 'Missing original PBR maps'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(fbx))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert len(meshes) == 1, 'This preparation contract expects one source mesh'
body = meshes[0]
world_points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
z_min = min(point.z for point in world_points)
z_max = max(point.z for point in world_points)
height = z_max - z_min
rim = [point for point in world_points if point.z > z_max - height * 0.05]
center_x = (min(point.x for point in rim) + max(point.x for point in rim)) / 2
center_y = (min(point.y for point in rim) + max(point.y for point in rim)) / 2
scale = spec['heightMm'] / 1000 / height
diameter_mm = (max(point.y for point in world_points) - min(point.y for point in world_points)) * scale * 1000
radius = diameter_mm / 2000
# Canonical frame: upright Z, handle on -X, front facing -Y (glTF +Z).
handle_positive_x = max(point.x for point in world_points) - center_x > center_x - min(point.x for point in world_points)
sign = -1 if handle_positive_x else 1
for vertex, point in zip(body.data.vertices, world_points):
    vertex.co = ((point.x - center_x) * sign * scale, (point.y - center_y) * sign * scale, (point.z - z_min) * scale)
body.matrix_world.identity()
body.data.update()
body.name = 'MUG_BODY'

# Rebuild standard PBR connections because the FBX references absent .fbm files.
material = bpy.data.materials.new('MUG_ORIGINAL')
material.use_nodes = True
nodes = material.node_tree.nodes
links = material.node_tree.links
bsdf = nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 1.0
bsdf.inputs['Metallic'].default_value = 1.0
for kind, socket in [('base', 'Base Color'), ('roughness', 'Roughness'), ('metallic', 'Metallic')]:
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(paths[kind]), check_existing=True)
    texture.image.colorspace_settings.name = 'sRGB' if kind == 'base' else 'Non-Color'
    links.new(texture.outputs['Color'], bsdf.inputs[socket])
normal_texture = nodes.new('ShaderNodeTexImage')
normal_texture.image = bpy.data.images.load(str(paths['normal']), check_existing=True)
normal_texture.image.colorspace_settings.name = 'Non-Color'
normal = nodes.new('ShaderNodeNormalMap')
links.new(normal_texture.outputs['Color'], normal.inputs['Color'])
links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
body.data.materials.clear()
body.data.materials.append(material)

# Follow the original curved surface. Reject the inner wall, bottom and handle.
selected_faces = []
for polygon in body.data.polygons:
    center = polygon.center
    radial = Vector((center.x, center.y, 0))
    distance = radial.length
    if distance < radius * 0.84 or distance > radius * 1.12:
        continue
    if not (0.001 < center.z < spec['heightMm'] / 1000 - 0.001):
        continue
    if polygon.normal.dot(radial.normalized()) <= 0.35:
        continue
    selected_faces.append(polygon)
assert len(selected_faces) > 1000, 'Print surface selection failed'

indices = sorted({index for polygon in selected_faces for index in polygon.vertices})
remap = {old: new for new, old in enumerate(indices)}
points = [body.data.vertices[index].co + body.data.vertices[index].normal * 0.00003 for index in indices]
faces = [[remap[index] for index in polygon.vertices] for polygon in selected_faces]
print_mesh = bpy.data.meshes.new('CylindricalPrintUV')
print_mesh.from_pydata(points, [], faces)
print_mesh.update()
uv = print_mesh.uv_layers.new(name='PRINT_UV')
for polygon in print_mesh.polygons:
    coords = [print_mesh.vertices[index].co for index in polygon.vertices]
    us = [0.5 - math.atan2(-point.y, point.x) / (math.pi * 2) for point in coords]
    if max(us) - min(us) > 0.5:
        us = [value + 1 if value < 0.5 else value for value in us]
    for loop_index, point, u in zip(polygon.loop_indices, coords, us):
        uv.data[loop_index].uv = (u, point.z / (spec['heightMm'] / 1000))
    polygon.use_smooth = True
overlay = bpy.data.objects.new(spec['printMeshName'], print_mesh)
bpy.context.collection.objects.link(overlay)
overlay['lab_print_overlay'] = True
overlay['surface_width_mm'] = math.pi * diameter_mm
overlay['surface_height_mm'] = spec['heightMm']
print_material = bpy.data.materials.new('LOGO_PRINT')
print_material.use_nodes = True
print_bsdf = print_material.node_tree.nodes.get('Principled BSDF')
print_bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
print_bsdf.inputs['Alpha'].default_value = 0
print_bsdf.inputs['Roughness'].default_value = 0.27
print_material.surface_render_method = 'DITHERED'
overlay.data.materials.append(print_material)

output_dir = root / 'public' / 'models' / 'mug'
output_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(model_dir / 'prepared.blend'))
bpy.ops.export_scene.gltf(filepath=str(output_dir / 'mug.glb'), export_format='GLB', export_yup=True, export_apply=True, export_extras=True, export_image_format='AUTO')
geometry = {
    'glbSha256': hashlib.sha256((output_dir / 'mug.glb').read_bytes()).hexdigest(),
    'heightMm': spec['heightMm'], 'bodyDiameterMm': round(diameter_mm, 6),
    'circumferenceMm': round(math.pi * diameter_mm, 6),
    'sourceTriangles': len(body.data.polygons), 'printTriangles': len(print_mesh.polygons),
    'sourceHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in [fbx, *paths.values()]},
    'canonicalFrame': 'glTF Y up; handle -X; FRONT +Z; BACK -Z; OPPOSITE +X',
}
(model_dir / 'geometry.json').write_text(json.dumps(geometry, indent=2) + '\n')
print('MUG_PREPARED ' + json.dumps({key: value for key, value in geometry.items() if key != 'sourceHashes'}))
