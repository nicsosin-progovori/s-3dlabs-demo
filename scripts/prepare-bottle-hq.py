"""Create a separate optimized HQ geometry master; keep the original untouched."""
import bpy
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('bottle_lod_tools',ROOT/'scripts/prepare-bottle-low.py')
tools=importlib.util.module_from_spec(spec);spec.loader.exec_module(tools)
MASTER=tools.MASTER
RAW=ROOT/'.cache/model-build/bottle-hq-v01.glb'
EDITABLE=ROOT/'models/bottle/prepared-hq-v01.blend'
REPORT=ROOT/'models/bottle/hq-v01-geometry.json'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
if Path(bpy.data.filepath).resolve()!=MASTER.resolve():raise RuntimeError('Load the approved original master first')
master_hash=sha(MASTER);reference_hash=sha(tools.HIGH)
root=next(o for o in bpy.data.objects if o.get('product_state')=='closed')
objects=[root,*root.children_recursive];replacements={};meshes=[]
for obj in objects:
    if obj.type!='MESH':continue
    old=obj.data;old.calc_loop_triangles();before=len(old.loop_triangles)
    if old not in replacements:
        if obj.name.startswith(tools.LATHE_NAMES):
            radial,tolerance=(96,.00002) if obj.name.startswith(('VacuumBottleBody','BottleBodyDecoration','SteelNeckAndInnerWall')) else (64,.000035)
            replacements[old]=tools.reduce_lathe(old,radial,tolerance)
            replacements[old].name=old.name+'_HQ'
        elif obj.name in ('InternalSteelThread','CapThreadDetail'):
            replacements[old]=tools.reduce_thread(old,1)
            replacements[old].name=old.name+'_HQ'
        elif before>64:
            obj.data=old.copy();bpy.context.view_layer.objects.active=obj
            modifier=obj.modifiers.new('Optimized HQ detail','DECIMATE');modifier.ratio=.55;modifier.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=modifier.name);replacements[old]=obj.data
        else:replacements[old]=old
    obj.data=replacements[old];obj.data.calc_loop_triangles()
    meshes.append({'name':obj.name,'before':before,'after':len(obj.data.loop_triangles)})
for image in bpy.data.images:
    if image.source=='GENERATED' or image.packed_file:
        width,height=image.size
        if width and height and max(width,height)>512:
            ratio=512/max(width,height);image.scale(round(width*ratio),round(height*ratio));image.pack()
for collection in bpy.data.collections:collection.hide_viewport=False;collection.hide_render=False
for obj in bpy.context.scene.objects:obj.hide_set(False);obj.select_set(obj in objects)
root['quality_version']='hq-optimized-v01'
bpy.context.view_layer.update();RAW.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(RAW),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_materials='EXPORT',export_normals=True,export_image_format='AUTO')
for collection in bpy.context.scene.collection.children:
    visible=root in collection.all_objects.values();collection.hide_viewport=not visible;collection.hide_render=not visible
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))
assert sha(MASTER)==master_hash and sha(tools.HIGH)==reference_hash
report={'sourceMaster':str(MASTER),'sourceMasterSha256':master_hash,'referenceGlbSha256':reference_hash,'sourceFile':EDITABLE.name,'rawExport':str(RAW.relative_to(ROOT)),'triangles':sum(m['after'] for m in meshes),'meshes':meshes,'maxTextureSize':512,'coatingTextureResolutionPreserved':True}
REPORT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'rawBytes':RAW.stat().st_size,'triangles':report['triangles']}))
