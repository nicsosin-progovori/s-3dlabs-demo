"""SOURCE MO3154 V02: soft two-tone cover, loose PU loops, open fasteners.

The supplied 220 x 220 x 109 mm is the body, not the strap footprint.
Secondary details are photo reconstructions; the original V01 is preserved.
Canonical runtime frame: X width, Y up, opening +Z, metres.
"""
import bpy
import bmesh
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace
from mathutils import Vector,Matrix,Quaternion
import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('source_helpers',HERE/'prepare-source-products.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
from pillow_straps import build_straps
from source_bottle import _maps
from source_bottle import _data_map
PI=math.pi
g=lambda p:(p[0],-p[2],p[1])
Z_SCALE=1
Z_SHIFT=0

def srgb(linear):
    v=np.maximum(0,linear)
    return np.where(v<=.0031308,12.92*v,1.055*v**(1/2.4)-.055)

def group(name,parent=None,part=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent
    if part:o['pillow_part']=part
    return o

def mesh(name,verts,faces,mat,parent,uv=None,consistent=True):
    o=a.mesh(name,[g(p) for p in verts],faces,mat,uv);o.parent=parent
    if consistent:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    return o

def cube(name,p,size,mat,parent,bevel=.0005):
    o=a.cube(name,g(p),(size[0],size[2],size[1]),mat,bevel);o.parent=parent;return o

def curve(name,points,radius,mat,parent):
    o=a.curve(name,[g(p) for p in points],radius,mat);o.parent=parent;return o

def textile(name,color,seed):
    m=a.material(name,color,0,.87);rng=np.random.default_rng(seed);y,x=np.mgrid[0:512,0:512]
    phase=2*PI*24/512
    warp=(.5+.5*np.cos(x*phase))**3;weft=(.5+.5*np.cos(y*phase+(np.floor(x*24/512)%2)*PI))**3
    h=(warp*.52+weft*.48)*.40+rng.random((512,512))*.055
    _maps(SimpleNamespace(),m,name,h*4,.82+rng.random((512,512))*.13,.66)
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Sheen Weight'].default_value=.24;bs.inputs['Sheen Roughness'].default_value=.83
    bs.inputs['Sheen Tint'].default_value=(.12,.14,.16,1)
    # Colour variation survives minification where individual normal-map fibres
    # are below a pixel; no painted studio light or shadow is baked into it.
    tone=.80+.32*(warp*.52+weft*.48)+rng.normal(0,.018,(512,512))
    image=a.pixels_image(name+'WeaveColour',srgb(np.clip(np.array(color)[None,None,:]*tone[:,:,None],0,1)))
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.extension='REPEAT'
    m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    return m

def profile(u):
    v=abs(u)
    if v<=.80:return math.radians(u/.80*118),1
    cap=(v-.80)/.20*PI/2
    return math.copysign(math.radians(118+44*math.sin(cap)),u),max(0,math.cos(cap))

def body_point(theta,phi,cap=1):
    # Slightly squared foam section gives a broad printing face and soft rim.
    c,s=math.cos(phi),math.sin(phi)
    radial=.074+.036*math.copysign(abs(c)**.78,c)*cap
    inner=math.exp(-((phi-PI)/.55)**2)
    # Two covered massage rollers push the lower inner fabric into the neck
    # opening. They are continuous cloth bulges, not holes or separate spheres.
    rollers=math.exp(-((phi-(PI+.28))/.18)**2)*(math.exp(-((theta-.42)/.26)**2)+math.exp(-((theta+.42)/.26)**2))
    radial-=.0065*rollers*cap
    radial+=.00030*inner*(math.exp(-((theta-.78)/.012)**2)+math.exp(-((theta+.78)/.012)**2))*cap
    h=(.5+.5*math.copysign(abs(s)**.86,s)-.018)/.982
    y=.010+.0445*cap*cap*(3-2*cap)+(.109*max(0,h)-.0545)*cap
    return Vector((radial*math.sin(theta),y,-radial*math.cos(theta)*Z_SCALE+Z_SHIFT))

def outer_point(theta,y,offset=0):
    h=(y/.109*.982+.018-.5)*2
    phi=math.asin(math.copysign(min(1,abs(h))**(1/.86),h))
    p=body_point(theta,phi)
    if offset==0:return p
    # Surface normal from finite differences, including the elongated footprint.
    t=body_point(theta+.0001,phi)-body_point(theta-.0001,phi)
    v=body_point(theta,phi+.0001)-body_point(theta,phi-.0001)
    n=v.cross(t).normalized()
    return p+n*offset

def body(parent,black,grey,seam):
    global Z_SCALE,Z_SHIFT
    n,m=256,96
    raw=[body_point(*profile(i/n*2-1)[:1],phi,profile(i/n*2-1)[1]) for i in range(n+1) for phi in np.linspace(0,2*PI,m,endpoint=False)]
    lo=min(v.z for v in raw);hi=max(v.z for v in raw);Z_SCALE=.220/(hi-lo);Z_SHIFT=-(hi+lo)*Z_SCALE/2
    verts=[];params=[]
    for i in range(1,n):
        theta,cap=profile(i/n*2-1)
        for j in range(m):verts.append(body_point(theta,2*PI*j/m,cap));params.append((i/n,j/m))
    verts.extend([body_point(*profile(-1)[:1],0,0),body_point(*profile(1)[:1],0,0)])
    faces=[];uvs=[];materials=[]
    for i in range(n-2):
        for j in range(m):
            k=(j+1)%m;faces.append((i*m+j,i*m+k,(i+1)*m+k,(i+1)*m+j))
            u=(i+1)/n*44;un=(i+2)/n*44;v=j/m*40;vn=(j+1)/m*40
            uvs.append([(u,v),(u,vn),(un,vn),(un,v)])
            phi=2*PI*(j+.5)/m;materials.append(1 if math.radians(48)<phi<math.radians(290) else 0)
    for end,index,ring in [(0,len(verts)-2,0),(1,len(verts)-1,(n-2)*m)]:
        for j in range(m):
            face=(index,ring+(j+1)%m,ring+j) if end==0 else (index,ring+j,ring+(j+1)%m)
            faces.append(face);uvs.append([(.01 if end==0 else 43.99,j/m*40),(end*44,(j+1)/m*40),(end*44,j/m*40)])
            phi=2*PI*(j+.5)/m;materials.append(1 if math.radians(48)<phi<math.radians(290) else 0)
    o=mesh('PillowContinuousCover',verts,faces,black,parent);o['pillow_part']='body';o.data.materials.append(grey)
    uv=o.data.uv_layers.new(name='PhysicalWeaveUV')
    for f,coords,material in zip(o.data.polygons,uvs,materials):
        f.material_index=material
        for index,coord in zip(f.loop_indices,coords):uv.data[index].uv=coord
    # The cover join is sewn, with subtle topstitching rather than a thick tube.
    for phi in [math.radians(48),math.radians(290)]:
        pts=[body_point(*profile(i/256*2-1)[:1],phi,profile(i/256*2-1)[1]) for i in range(5,252)]
        curve('CoverJoin',pts,.00023,seam,parent)
    for side in [-1,1]:
        theta=side*.78;pts=[]
        for phi in np.linspace(math.radians(48),PI*1.5-.35,140):
            p=body_point(theta,phi);dt=body_point(theta+.0001,phi)-body_point(theta-.0001,phi);dp=body_point(theta,phi+.0001)-body_point(theta,phi-.0001)
            pts.append(p+dp.cross(dt).normalized()*.00004)
        curve('InnerPanelSeamLeft' if side<0 else 'InnerPanelSeamRight',pts,.00009,seam,parent)
    # Many short physical stitches share one curve datablock for a cheap macro.
    data=bpy.data.curves.new('FineCoverTopstitch','CURVE');data.dimensions='3D';data.bevel_depth=.000075;data.bevel_resolution=1
    for i in range(8,249,2):
        theta,cap=profile(i/256*2-1);theta2,cap2=profile((i+.7)/256*2-1)
        p=body_point(theta,math.radians(50),cap);q=body_point(theta2,math.radians(50),cap2)
        sp=data.splines.new('POLY');sp.points.add(1)
        for v,pnt in zip(sp.points,[p,q]):v.co=(*g(pnt),1)
    stitches=bpy.data.objects.new('FineCoverTopstitch',data);bpy.context.collection.objects.link(stitches);stitches.parent=parent;stitches.data.materials.append(seam)
    marker=group('FabricFocus',parent);marker.location=g(body_point(math.radians(70),math.radians(49)));marker['pillow_focus']='fabric';marker['half_m']=[.022,.014,.022]
    marker=group('CoveredRollersFocus',parent);marker.location=g(body_point(0,PI+.28));marker['pillow_focus']='rollers';marker['half_m']=[.032,.020,.015]
    return o

def port_distance(x,y):
    dx=abs(x+.016)-.0001;dy=abs(y-.001)-.0018
    return np.sqrt(np.maximum(dx,0)**2+np.maximum(dy,0)**2)+np.minimum(np.maximum(dx,dy),0)-.0008

def panel_height(x,y):
    return .00060+.00010*max(0,1-(x/.022)**2-(y/.010)**2)

def controls(parent,rubber,dark,mark):
    panel=group('PillowControlAssembly',parent,'controls');theta=math.radians(-100);cy=.052
    # Symbols are part of the silicone skin, not floating tubes with open ends.
    # The shallow button grooves live in its normal map; symbols stay flush.
    width,height=.042,.018;x=np.linspace(-width/2,width/2,1024);y=np.linspace(-height/2,height/2,440);xx,yy=np.meshgrid(x,y)
    rng=np.random.default_rng(31543);tone=1+rng.normal(0,.003,xx.shape)
    rgb=np.array([.20,.215,.22])[None,None,:]*tone[:,:,None]
    relief=np.zeros_like(xx)
    def stroke(distance,colour,feather=.00003):
        mask=np.clip(.5-distance/(2*feather),0,1)
        rgb[:]=rgb*(1-mask[:,:,None])+np.array(colour)[None,None,:]*mask[:,:,None]
    for centre in [-.0035,.0105]:
        r=np.hypot(xx-centre,yy);stroke(np.abs(r-.0036)-.000065,(.13,.145,.15));relief-=.00006*np.exp(-((r-.0036)/.00016)**2)
    for dx,length in [(-.0014,.0026),(0,.0037),(.0014,.0026)]:
        stroke(np.hypot(xx-(-.0035+dx),np.maximum(np.abs(yy)-length/2,0))-.00012,(.105,.12,.125))
    px=xx-.0105;ring=np.abs(np.hypot(px,yy)-.0020)-.00012
    angle=np.abs(np.arctan2(px,yy));ring=np.maximum(ring,(.55-angle)*.001)
    stroke(ring,(.105,.12,.125));stroke(np.hypot(px,np.maximum(np.maximum(.0003-yy,yy-.0025),0))-.00012,(.105,.12,.125))
    stroke(port_distance(xx,yy),(.006,.009,.012),.00005)
    stroke(np.hypot(xx+.010,yy)-.00022,(.07,.085,.09),.00003)
    image=a.pixels_image('SiliconePrintedSymbols',srgb(rgb));tex=rubber.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;rubber.node_tree.links.new(tex.outputs['Color'],rubber.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    gy,gx=np.gradient(relief,height/440,width/1024);normal=np.stack((-gx,-gy,np.ones_like(gx)),axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    image=_data_map(SimpleNamespace(),'SiliconeDebossNormal',normal*.5+.5);tex=rubber.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;n=rubber.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.55;rubber.node_tree.links.new(tex.outputs['Color'],n.inputs['Color']);rubber.node_tree.links.new(n.outputs['Normal'],rubber.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    boundary=[]
    for side,start in [(1,-PI/2),(-1,PI/2)]:
        for j in range(80):
            ang=start+j/79*PI;boundary.append((side*(width-height)/2+height/2*math.cos(ang),height/2*math.sin(ang)))
        # Sample the straight edges too: a single 24 mm chord would facet the
        # curved silicone into a visible diagonal even with dense radial rings.
        for j in range(1,72):boundary.append((side*(width-height)/2*(1-2*j/72),side*height/2))
    verts=[outer_point(theta,cy,panel_height(0,0))];uv=[(.5,.5)];faces=[];count=len(boundary);rings=80
    for k in range(1,rings+1):
        t=k/rings
        for x,y in boundary:
            x*=t;y*=t;verts.append(outer_point(theta-x/(.110*Z_SCALE),cy+y,panel_height(x,y)));uv.append((.5+x/width,.5+y/height))
    for j in range(count):faces.append((0,1+j,1+(j+1)%count))
    for k in range(rings-1):
        for j in range(count):a0=1+k*count+j;b0=1+k*count+(j+1)%count;faces.append((a0+count,b0+count,b0,a0))
    for x,y in boundary:verts.append(outer_point(theta-x/(.110*Z_SCALE),cy+y,.00008));uv.append((.5+x/width,.5+y/height))
    front=1+(rings-1)*count;back=1+rings*count
    for j in range(count):faces.append((front+j,back+j,back+(j+1)%count,front+(j+1)%count))
    o=mesh('SiliconeControlPanel',verts,faces,rubber,panel,uv,False);o['single_silicone_skin']=True;o['front_face_count']=count*rings

def decoration(parent,material):
    verts=[];uv=[];faces=[];theta=math.radians(95);n,m=80,32
    # Arc length is measured on the elongated cushion, not on a nominal circle.
    # Each UV row spans the specified physical 80 mm across its curved surface.
    angles=[]
    samples=np.linspace(theta-.8,theta+.8,1601)
    for j in range(m+1):
        y=.0545+(j/m-.5)*.040;points=np.array([tuple(outer_point(t,y)) for t in samples]);arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points,axis=0),axis=1))];arc-=arc[800]
        angles.append(np.interp(np.linspace(-.040,.040,n+1),arc,samples))
    for i in range(n+1):
        for j in range(m+1):
            verts.append(outer_point(float(angles[j][i]),.0545+(j/m-.5)*.040,.00008));uv.append((1-i/n,j/m))
    for i in range(n):
        for j in range(m):a0=i*(m+1)+j;faces.append((a0,a0+1,a0+m+2,a0+m+1))
    o=mesh('PillowCurvedDecoration',verts,faces,material,parent,uv,False);o['print_surface']='side';o['pillow_part']='decoration'

def bounds(o):
    pts=[o.matrix_world@Vector(v) for v in o.bound_box];p=[Vector((v.x,v.z,-v.y)) for v in pts]
    return {'min':[min(v[k] for v in p) for k in range(3)],'max':[max(v[k] for v in p) for k in range(3)]}

def build():
    a.reset();root=group('PillowStudioV02');root['pillow_version']=2;root['product_state']='ready'
    black=textile('PillowBlackPolyesterV02',(.014,.017,.018),31540);grey=textile('PillowGreyPolyesterV02',(.17,.18,.18),31541)
    seam=a.material('FineGreyCoverThread',(.068,.079,.085),0,.9)
    pu=a.material('PUStrapCoated',(.023,.028,.032),0,.64);rng=np.random.default_rng(31542);h=rng.random((512,512));_maps(SimpleNamespace(),pu,'PULeatherGrain',h,.61+h*.10,.17)
    edge=a.material('PUCutEdge',(.045,.052,.057),0,.75);plastic=a.material('POMFasteners',(.075,.084,.09),0,.50)
    rubber=a.material('MatteSiliconeControls',(.115,.13,.14),0,.72);dark=a.material('RecessedDarkRubber',(.015,.019,.023),0,.68);mark=a.material('EmbossedSiliconeSymbols',(.068,.08,.086),0,.77)
    cover=group('PillowCoverAssembly',root);body(cover,black,grey,seam);controls(root,rubber,dark,mark);build_straps(SimpleNamespace(group=group,mesh=mesh,cube=cube,body_point=body_point),root,pu,edge,plastic,dark)
    decoration(root,a.material('TransparentDecorationPlaceholder',(1,1,1),0,.7))
    bpy.context.view_layer.update()
    source=ROOT/'models/pillow/prepared-v02.blend';output=ROOT/'public/models/pillow/pillow-v02.glb'
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_yup=True,export_apply=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_materials='EXPORT')
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source))
    data={'version':2,'units':'metres','glbSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'sourceFile':source.name,'assetFile':output.name,'bodyNominalMm':[220,109,220],'bodyBounds':bounds(bpy.data.objects['PillowContinuousCover']),'reference':'https://www.source-werbeartikel.com/wiederaufladbares-massagkissen','state':'ready','secondaryDetails':'Photographic reconstruction of seams, controls, loose PU loops and open buckle halves. Embroidery is an owner-authorized visualization method.'}
    (ROOT/'models/pillow/geometry-v02.json').write_text(json.dumps(data,indent=2)+'\n');print('PILLOW_STUDIO_READY '+json.dumps(data))

if __name__=='__main__':build()
