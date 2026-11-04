"""SOURCE Endo V02: one inextensible textile skin, rigid sensor and hinged box.

Canonical runtime frame: metres, X=width, Y=front, Z=strap length.
The 240 mm length and reconstructed packaging interior remain visual estimates.
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace
from mathutils import Vector
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import importlib.util
spec=importlib.util.spec_from_file_location('source_helpers',HERE/'prepare-source-products.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
from source_bottle import _maps

ROOT=HERE.parent
g=lambda p:(p[0],-p[2],p[1])

def group(name,parent=None,part=None):
    obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj);obj.parent=parent
    if part:obj['endo_part']=part
    return obj

def cube(name,p,size,mat,parent,bevel=.0004):
    obj=a.cube(name,g(p),(size[0],size[2],size[1]),mat,bevel);obj.parent=parent
    return obj

def textile(name,velcro=False):
    mat=a.material(name,(.022,.025,.029),0,.86 if not velcro else .94)
    rng=np.random.default_rng(33090+int(velcro));y,x=np.mgrid[0:512,0:512]
    if velcro:height=rng.random((512,512))*.42+np.sin(x*.9)*np.sin(y*.8)*.08
    else:
        row=(.5+.5*np.cos(y*2*math.pi/32))**5
        warp=(.5+.5*np.sin(x*2*math.pi/16))**3
        height=row*(.52+.22*warp)+.10*warp+rng.random((512,512))*.07
    _maps(SimpleNamespace(),mat,name,height*(2.2 if velcro else 5),.80+height*.13,.5 if velcro else .8)
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Sheen Weight'].default_value=.22;bs.inputs['Sheen Roughness'].default_value=.8
    # A white sheen exports as full-strength white in KHR_materials_sheen.
    # Tint the woven-fibre reflection so the black fabric retains its depth.
    bs.inputs['Sheen Tint'].default_value=(.11,.12,.14,1)
    return mat

def build():
    a.reset()
    root=group('EndoMotionRig');root['endo_rig_version']=2;root['strap_length_mm']=240
    tracker=group('EndoTrackerRoot',root,'tracker')
    module=group('EndoModuleAssembly',tracker,'module')
    strapmat=textile('EndoStrapWoven');velcro=textile('EndoStrapVelcro',True)
    frame=a.material('EndoFrameCoatedZinc',(.028,.034,.042),.48,.37)
    abs_mat=a.material('EndoSensorABS',(.011,.014,.019),0,.49)
    glass=a.material('EndoOpticalGlass',(.009,.015,.021),.15,.12)
    gold=a.material('EndoChargingGold',(.55,.38,.12),.9,.27)
    ink=a.material('PackagingInk',(.14,.16,.14),0,.93)
    paper=a.material('EndoPaper',(.78,.765,.73),0,.91)
    kraft=a.material('EndoKraft',(.41,.29,.18),0,.94)
    rng=np.random.default_rng(330901)
    for mat,name in [(paper,'Paper'),(kraft,'Kraft')]:
        h=rng.random((256,256)).astype(np.float32)
        _maps(SimpleNamespace(),mat,'Endo'+name,h,.86+h*.1,.13)
    cube('SensorHousing',(0,-.001,0),(.026,.006,.041),abs_mat,module,.0028)
    for x in [-.0125,.0125]:cube('FrameRail',(x,.0029,0),(.002,.0022,.042),frame,module,.0006)
    for z in [-.0195,.0185]:cube('FrameBridge',(0,.0029,z),(.025,.0022,.005),frame,module,.0006)
    cube('OpticalSensorWindow',(0,-.0042,-.001),(.015,.0007,.016),glass,module,.003)
    for x,z in [(-.003,-.004),(.003,-.004),(-.003,.002),(.003,.002)]:
        cube('OpticalContact',(x,-.00465,z),(.0019,.0002,.0019),gold,module,.0006)
    for x in [-.003,.003]:cube('ChargeContact',(x,-.00435,.011),(.0016,.0005,.0016),gold,module,.0005)
    overlay=a.material('EndoTransparentDecoration',(1,1,1),0,.5)
    verts=[(-.009,.00408,.020),(.009,.00408,.020),(.009,.00408,.017),(-.009,.00408,.017)]
    deco=a.mesh('EndoDecoration',[g(p) for p in verts],[(0,1,2,3)],overlay,[(0,0),(1,0),(1,1),(0,1)],False)
    deco['print_surface']='front';deco.parent=module

    # Independent joints keep the deformation frame deterministic and editable.
    armdata=bpy.data.armatures.new('EndoTextileSkeleton')
    arm=bpy.data.objects.new('EndoTextileSkeleton',armdata);bpy.context.collection.objects.link(arm);arm.parent=tracker
    arm['endo_part']='strap-rig';arm.show_in_front=True
    bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    samples=[(i-72)*.001875 for i in range(129)]
    for i,s in enumerate(samples):
        b=armdata.edit_bones.new(f'EndoStrapBone_{i:03d}');b.head=g((0,.00265,s));b.tail=g((0,.00265,s+.001))
    bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
    for i,s in enumerate(samples):armdata.bones[f'EndoStrapBone_{i:03d}']['material_s']=s
    # Rounded rectangle, with a soft, slightly tapered tip at both ends.
    cross=[]
    for cx,cy,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)]:
        for j in range(4):
            angle=math.radians(start+j*30)
            cross.append((cx*(.0105-.00022)+.00022*math.cos(angle),cy*(.00060-.00022)+.00022*math.sin(angle)))
    verts=[];uv=[];faces=[];matids=[];rings=len(cross)
    for i,s in enumerate(samples):
        end_distance=min(s+.135,.105-s)
        taper=1 if end_distance>.0025 else math.sqrt(max(.005,1-((.0025-end_distance)/.0025)**2))
        for x,y in cross:
            verts.append(g((x*taper,.00265+y,s)));uv.append((x/.012+.5,(s+.135)/.012))
    for i in range(128):
        for j in range(rings):
            faces.append((i*rings+j,i*rings+(j+1)%rings,(i+1)*rings+(j+1)%rings,(i+1)*rings+j))
            matids.append(1 if samples[i]<-.105 or cross[j][1]<0 else 0)
    faces.extend([tuple(reversed(range(rings))),tuple(range(128*rings,129*rings))]);matids.extend([1,0])
    band=a.mesh('EndoContinuousWovenStrap',verts,faces,strapmat,uv);band.data.materials.append(velcro);band.parent=tracker
    for poly,idx in zip(band.data.polygons,matids):poly.material_index=idx
    for i in range(129):
        vg=band.vertex_groups.new(name=f'EndoStrapBone_{i:03d}');vg.add(list(range(i*rings,(i+1)*rings)),1,'REPLACE')
    modifier=band.modifiers.new('EndoTextileDeformation','ARMATURE');modifier.object=arm
    band['endo_part']='strap';band['strap_length_mm']=240;band['strap_segments']=128
    buckle=group('EndoAdjustmentBuckle',tracker,'buckle')
    buckle.location=g((0,.00265,.100))
    for x in [-.012,.012]:cube('BuckleSide',(x,0,0),(.002,.0024,.010),frame,buckle,.0005)
    for z in [-.004,.004]:cube('BuckleBridge',(0,0,z),(.026,.0024,.002),frame,buckle,.0005)

    packaging=group('EndoGiftBox',root,'box')
    cube('BoxBottom',(0,.0006,0),(.143,.0012,.084),kraft,packaging,.0004)
    for x in [-.0708,.0708]:cube('BoxSide',(x,.008,0),(.0014,.016,.084),kraft,packaging,.0004)
    for z in [-.0413,.0413]:cube('BoxEnd',(0,.008,z),(.143,.016,.0014),kraft,packaging,.0004)
    cube('PaperTray',(0,.0016,0),(.137,.0012,.078),paper,packaging,.001)
    cube('TrayRecess',(0,.00224,0),(.128,.0001,.035),kraft,packaging,.001)
    cube('QuickStartLeaflet',(.045,.0026,.027),(.033,.0007,.018),paper,packaging,.0003)
    lid=group('EndoBoxHinge',packaging,'lid');lid.location=g((0,.0155,-.042))
    cube('GiftBoxLid',(0,.00075,.042),(.143,.0015,.084),kraft,lid,.0005)
    cube('InnerLidPaper',(0,-.00005,.042),(.137,.00018,.078),paper,lid,.0003)
    cube('PackagingLabel',(0,.00159,.042),(.129,.00018,.070),paper,lid,.0003)
    # Printed product identity belongs to the lid and follows its hinge.
    for name,text,loc,size in [('PackageTitle','Endo',(.022,.00175,.033),.012),('PackageSubtitle','HEALTH TRACKER',(.022,.00175,.048),.0032)]:
        obj=a.label(name,text,g(loc),size,ink);obj.parent=lid
    outline=[(-.051,.0018,.025),(-.027,.0018,.025),(-.027,.0018,.059),(-.051,.0018,.059),(-.051,.0018,.025)]
    obj=a.curve('PackageTrackerOutline',[g(p) for p in outline],.0002,ink);obj.parent=lid
    tracker.rotation_euler.z=math.pi/2 # Blender Z -> runtime Y, long strap along X.
    tracker.location.z=.0048
    packaging.location=g((-.60,0,.05))
    bpy.context.view_layer.update()
    output=ROOT/'public/models/endo/endo-rig-v02.glb';source=ROOT/'models/endo/prepared-v02.blend'
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_yup=True,export_apply=True,export_extras=True,export_skins=True,export_animations=False,export_cameras=False,export_lights=False,export_materials='EXPORT')
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source))
    metadata={'version':2,'glbSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'sourceFile':'prepared-v02.blend','assetFile':'endo-rig-v02.glb','units':'metres','strapLengthMm':240,'materialRangeMm':[-135,105],'segments':128,'bones':129,'canonicalFrame':'glTF Y-up; tracker local X width, Y front, Z material length','moduleMm':[27,8,42],'boxMm':[143,17,84],'reference':'https://www.source-werbeartikel.com/endo-gesundheitstracker-51-p330-90-c','approximation':'240 mm strap and reconstructed hinged packaging interior; owner authorizes visual approximation.'}
    (ROOT/'models/endo/rig-v02.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('ENDO_RIG_READY '+json.dumps(metadata))

if __name__=='__main__':build()
