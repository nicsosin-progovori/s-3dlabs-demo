"""Read both exported GLBs and compare corresponding surfaces in world space."""
import bpy
import json
import sys
from pathlib import Path
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent.parent
quality=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'low'
if quality not in ('low','hq'):raise RuntimeError('Expected low or hq')
candidate=f'bottle-{quality}-v01.glb'
OUT=ROOT/f'.cache/qa/bottle-{quality}-v01/surface-error.json'

def geometry(obj):
    obj.data.calc_loop_triangles()
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    faces=[tuple(face.vertices) for face in obj.data.loop_triangles]
    samples=points+[(points[a]+points[b]+points[c])/3 for a,b,c in faces]
    return BVHTree.FromPolygons(points,faces,all_triangles=True),samples

bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/bottle/bottle.glb'))
root=next(o for o in bpy.data.objects if o.get('product_state')=='closed')
high={o.name:o for o in root.children_recursive if o.type=='MESH'}
for obj in bpy.data.objects:obj.name='HQ_'+obj.name
existing=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/bottle'/candidate))
root=next(o for o in bpy.data.objects if o not in existing and o.get('product_state')=='closed')
low={o.name:o for o in root.children_recursive if o.type=='MESH'}
bpy.context.view_layer.update()
report=[]
for name,obj in low.items():
    if name not in high:raise RuntimeError('Unmatched surface '+name)
    high_bvh,high_samples=geometry(high[name]);low_bvh,low_samples=geometry(obj)
    errors=[low_bvh.find_nearest(point)[3]*1000 for point in high_samples]
    errors.extend(high_bvh.find_nearest(point)[3]*1000 for point in low_samples)
    errors.sort()
    report.append({'name':name,'samples':len(errors),'maxMm':max(errors),'p95Mm':errors[int(len(errors)*.95)]})
result={'candidate':candidate,'method':'Bidirectional vertex and triangle-centroid nearest-surface samples on actual exported GLBs; world-space millimetres','maxMm':max(r['maxMm'] for r in report),'samples':sum(r['samples'] for r in report),'surfaces':report}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
assert result['maxMm']<(.35 if quality=='low' else .06),'Derived surface deviates too far from the reference'
assert next(r for r in report if r['name']=='VacuumBottleBody')['maxMm']<(.15 if quality=='low' else .04),'Body silhouette deviation is too large'
