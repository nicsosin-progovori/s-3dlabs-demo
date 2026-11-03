"""Derive the first-paint bottle from the approved Blender master, without changing HQ.

Run with the project's installed native Blender in background mode. The low GLB
contains the closed assembly; all three states are animated by the existing rig.
"""
import bpy
import hashlib
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
MASTER = Path('/Users/nsosin/Projects/source-3d/models/bottle/prepared-v02.blend')
HIGH = ROOT / 'public/models/bottle/bottle.glb'
LOW = ROOT / 'public/models/bottle/bottle-low-v01.glb'
EDITABLE = ROOT / 'models/bottle/prepared-low-v01.blend'
RECEIPT = ROOT / 'models/bottle/low-v01.json'
RADIAL = 48
PROFILE_ERROR = .00008
LATHE_NAMES = ('VacuumBottleBody', 'SteelNeckAndInnerWall', 'BaseRim',
               'BottleBodyDecoration', 'LidSteelCollar', 'LidBambooTop',
               'LidThreadPlug', 'LidSiliconeSeal')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def simplify(points, tolerance):
    """Retain source profile samples, with a bounded distance to their polyline."""
    if len(points) <= 2:
        return list(range(len(points)))
    def recurse(first, last):
        delta = points[last] - points[first]
        maximum, at = 0, None
        for i in range(first + 1, last):
            t = max(0, min(1, (points[i] - points[first]).dot(delta) / max(delta.length_squared, 1e-20)))
            distance = (points[i] - points[first] - delta * t).length
            if distance > maximum:
                maximum, at = distance, i
        return recurse(first, at)[:-1] + recurse(at, last) if maximum > tolerance else [first, last]
    return recurse(0, len(points) - 1)


def reduce_lathe(data, radial=RADIAL, tolerance=PROFILE_ERROR):
    # The master was authored with 192 angular segments and a duplicated UV seam.
    stride = 193
    if len(data.vertices) % stride:
        raise RuntimeError('Unexpected authored lathe topology: ' + data.name)
    rows = len(data.vertices) // stride
    profile = [Vector((math.hypot(*data.vertices[j * stride].co[:2]), data.vertices[j * stride].co.z)) for j in range(rows)]
    selected = simplify(profile, tolerance)
    # The support at each authored height/radius extreme is retained exactly.
    selected = sorted(set(selected + [min(range(rows), key=lambda i: profile[i][a]) for a in (0, 1)] + [max(range(rows), key=lambda i: profile[i][a]) for a in (0, 1)]))
    old_uv = data.uv_layers.active
    uv_by_vertex = {}
    if old_uv:
        for loop in data.loops:
            uv_by_vertex.setdefault(loop.vertex_index, tuple(old_uv.data[loop.index].uv))
    vertices, normals, uvs, faces = [], [], [], []
    for j in selected:
        for i in range(radial + 1):
            original = data.vertices[j * stride + i * (192 // radial)]
            vertices.append(tuple(original.co))
            normals.append(tuple(original.normal))
            uvs.append(uv_by_vertex.get(original.index, (i / radial, original.co.z / .21)))
    for j in range(len(selected) - 1):
        for i in range(radial):
            a = j * (radial + 1) + i
            faces.append((a, a + 1, a + radial + 2, a + radial + 1))
    result = bpy.data.meshes.new(data.name + '_Low')
    result.from_pydata(vertices, [], faces)
    result.update()
    uv = result.uv_layers.new(name='SurfaceUV')
    for face in result.polygons:
        face.use_smooth = True
        for li in face.loop_indices:
            uv.data[li].uv = uvs[result.loops[li].vertex_index]
    if hasattr(result, 'normals_split_custom_set_from_vertices'):
        result.normals_split_custom_set_from_vertices(normals)
    for material in data.materials:
        result.materials.append(material)
    return result


def reduce_thread(data, path_step):
    # Keep a continuous tube. Aggressive triangle collapse can erase whole
    # turns of the very thin helix even when the outer bottle bounds still fit.
    stride=10
    if len(data.vertices)%stride:
        raise RuntimeError('Unexpected thread profile: '+data.name)
    rings=list(range(0,len(data.vertices)//stride,path_step))
    if rings[-1]!=len(data.vertices)//stride-1:rings.append(len(data.vertices)//stride-1)
    uv_by_vertex={}
    for loop in data.loops:uv_by_vertex.setdefault(loop.vertex_index,tuple(data.uv_layers.active.data[loop.index].uv))
    vertices=[];normals=[];uvs=[];faces=[]
    for ring in rings:
        for side in range(0,stride,2):
            vertex=data.vertices[ring*stride+side]
            vertices.append(tuple(vertex.co));normals.append(tuple(vertex.normal));uvs.append(uv_by_vertex[vertex.index])
    for ring in range(len(rings)-1):
        for side in range(5):
            a=ring*5+side;b=ring*5+(side+1)%5
            faces.append((a,b,b+5,a+5))
    result=bpy.data.meshes.new(data.name+'_Low')
    result.from_pydata(vertices,[],faces);result.update()
    uv=result.uv_layers.new(name='SurfaceUV')
    for face in result.polygons:
        face.use_smooth=True
        for li in face.loop_indices:uv.data[li].uv=uvs[result.loops[li].vertex_index]
    if hasattr(result,'normals_split_custom_set_from_vertices'):result.normals_split_custom_set_from_vertices(normals)
    for material in data.materials:result.materials.append(material)
    return result


def main():
    if Path(bpy.data.filepath).resolve() != MASTER.resolve():
        raise RuntimeError('Load the exact approved bottle master first')
    master_hash, high_hash = sha(MASTER), sha(HIGH)
    root = next(o for o in bpy.data.objects if o.get('product_state') == 'closed')
    objects = [root, *root.children_recursive]
    replacements, report = {}, []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        old = obj.data
        old.calc_loop_triangles()
        before = len(old.loop_triangles)
        if old not in replacements:
            if obj.name.startswith(LATHE_NAMES):
                radial, tolerance = (48, .00008) if obj.name.startswith(('VacuumBottleBody', 'BottleBodyDecoration')) else (24, .0002) if obj.name.startswith(('LidThreadPlug', 'LidSiliconeSeal')) else (32, .00016)
                replacements[old] = reduce_lathe(old, radial, tolerance)
            elif obj.name in ('InternalSteelThread','CapThreadDetail'):
                replacements[old]=reduce_thread(old,4 if obj.name=='InternalSteelThread' else 3)
            elif before > 64:
                # Small helical threads, handle and rivets retain their source form.
                obj.data = old.copy()
                bpy.context.view_layer.objects.active = obj
                modifier = obj.modifiers.new('Low first-paint geometry', 'DECIMATE')
                modifier.ratio = .15 if 'Handle' in obj.name and 'Rivet' not in obj.name else .18
                modifier.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=modifier.name)
                replacements[old] = obj.data
            else:
                replacements[old] = old
        obj.data = replacements[old]
        obj.data.calc_loop_triangles()
        report.append({'name': obj.name, 'before': before, 'after': len(obj.data.loop_triangles)})
    # Preserve the mean material response and original UVs, with much smaller maps.
    for image in bpy.data.images:
        if image.source == 'GENERATED' or image.packed_file:
            limit = 128 if 'Colour' in image.name else 64
            width, height = image.size
            if width and height:
                scale = min(1, limit / max(width, height))
                image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
                image.pack()
    for collection in bpy.data.collections:
        collection.hide_viewport = False
        collection.hide_render = False
    for obj in bpy.context.scene.objects:
        obj.hide_set(False)
        obj.select_set(obj in objects)
    root['quality_version'] = 'low-v01'
    bpy.context.view_layer.update()
    LOW.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(LOW), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_extras=True, export_cameras=False,
        export_lights=False, export_materials='EXPORT', export_normals=True,
        export_image_format='AUTO')
    for collection in bpy.context.scene.collection.children:
        visible=root in collection.all_objects.values()
        collection.hide_viewport=not visible
        collection.hide_render=not visible
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))
    if sha(MASTER) != master_hash or sha(HIGH) != high_hash:
        raise RuntimeError('A protected input changed')
    receipt = {'sourceMaster': str(MASTER), 'sourceMasterSha256': master_hash,
        'highGlbSha256': high_hash, 'highBytes': HIGH.stat().st_size,
        'glbSha256': sha(LOW), 'bytes': LOW.stat().st_size,
        'sourceFile': EDITABLE.name, 'radialSegments': RADIAL,
        'profileToleranceMm': PROFILE_ERROR * 1000, 'detailProfileToleranceMm': .2,
        'detailRadialSegments': [24, 32],
        'units': 'metres', 'canonicalFrame': 'glTF Y-up, front +Z; original pivots and UVs',
        'storedStates': ['closed'], 'runtimeStates': ['closed', 'open', 'lying'],
        'triangles': sum(r['after'] for r in report), 'meshes': report,
        'images': [{'name': image.name, 'width': image.size[0], 'height': image.size[1]} for image in bpy.data.images if image.size[0]]}
    RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'lowBytes': receipt['bytes'], 'highBytes': receipt['highBytes'],
        'triangles': receipt['triangles'], 'reduction': round(receipt['highBytes'] / receipt['bytes'], 2)}))


if __name__=='__main__':
    main()
