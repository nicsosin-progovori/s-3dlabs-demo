"""Native saved-source checks for the SOURCE pillow, including ribbon collisions."""
import bpy
import json
from pathlib import Path
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent.parent
def tree(o):
    return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons],epsilon=.000001)

body=bpy.data.objects['PillowContinuousCover'];body_tree=tree(body)
straps=[o for o in bpy.data.objects if o.get('pillow_strap_side')]
report={'source':bpy.data.filepath,'straps':[],'siliconeSkins':len([o for o in bpy.data.objects if o.get('single_silicone_skin')]),'floatingSymbolObjects':[o.name for o in bpy.data.objects if o.name.startswith(('PowerStem','PowerSymbol','EmbossedButtonRing','MassageWave'))],'innerPanelSeams':[o.name for o in bpy.data.objects if o.name.startswith('InnerPanelSeam')],'attachmentCuffs':len([o for o in bpy.data.objects if o.get('pillow_attachment_cuff')])}
for o in straps:
    bvh=tree(o);faces=[set(p.vertices) for p in o.data.polygons]
    stations=[{i//4 for i in f} for f in faces]
    centres=[sum((o.data.vertices[k+j].co for j in range(4)),o.data.vertices[k].co*0)/4 for k in range(0,len(o.data.vertices),4)]
    arc=[0]
    for a,b in zip(centres,centres[1:]):arc.append(arc[-1]+(b-a).length)
    intersections=[]
    for i,j in bvh.overlap(bvh):
        if i>=j or faces[i]&faces[j]:continue
        if min(abs(a-b) for a in stations[i] for b in stations[j])<=8:continue
        intersections.append([i,j])
    fabric=[]
    for _,j in body_tree.overlap(bvh):
        if min(arc[k] for k in stations[j])>.012 and arc[-1]-max(arc[k] for k in stations[j])>.012:fabric.append(j)
    report['straps'].append({'side':o['pillow_strap_side'],'stations':len(centres),'selfIntersectionPairs':intersections,'bodyIntersectionsAfterSewnTab':sorted(set(fabric)),'minimumHeightMm':min((o.matrix_world@v.co).z for v in o.data.vertices)*1000})
report['interStrapIntersections']=tree(straps[0]).overlap(tree(straps[1])) if len(straps)==2 else ['missing strap']
report['cuffBodyIntersectionPairs']={o.name:len(tree(o).overlap(body_tree)) for o in bpy.data.objects if o.get('pillow_attachment_cuff')}
report['cuffSelfIntersectionPairs']={o.name:len([(i,j) for i,j in tree(o).overlap(tree(o)) if i<j and not set(o.data.polygons[i].vertices)&set(o.data.polygons[j].vertices)]) for o in bpy.data.objects if o.get('pillow_attachment_cuff')}
panel=bpy.data.objects['SiliconeControlPanel']
reference=panel.data.polygons[0].normal
report['siliconeFrontNormalMinDot']=min(f.normal.dot(reference) for f in panel.data.polygons[:panel.get('front_face_count',len(panel.data.polygons)-302)])
report['minimumModelHeightMm']=min((o.matrix_world@v.co).z for o in bpy.data.objects if o.type=='MESH' and not o.get('print_surface') for v in o.data.vertices)*1000
out=ROOT/'.cache/qa/pillow-studio-20261030/geometry-check.json';out.write_text(json.dumps(report,indent=2)+'\n')
print('PILLOW_NATIVE_GEOMETRY '+json.dumps(report))
assert len(straps)==2 and report['siliconeSkins']==1
assert len(report['innerPanelSeams'])==2 and 'InnerBackSeam' not in bpy.data.objects
assert report['attachmentCuffs']==2
assert not any(report['cuffBodyIntersectionPairs'].values())
assert not any(report['cuffSelfIntersectionPairs'].values())
assert report['siliconeFrontNormalMinDot']>.8,'The silicone skin must face consistently outward'
assert not report['floatingSymbolObjects'] and not report['interStrapIntersections']
assert report['minimumModelHeightMm']>=-.001
for r in report['straps']:
    assert not r['selfIntersectionPairs'],'Ribbon intersects itself: '+str(r)
    assert not r['bodyIntersectionsAfterSewnTab'],'Ribbon intersects the cushion beyond its stitched anchor: '+str(r)
