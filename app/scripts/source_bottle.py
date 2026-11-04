"""MO9431 V02: smooth manufactured profiles and embedded, deterministic PBR.

The dimensions, state roots, lid pivot and print UV contract are retained.
All textures are authored here; no downloaded assets or runtime CDN are needed.
"""
import math
import hashlib
import numpy as np
import bpy
from mathutils import Vector


def _profile(keys, steps=3):
    """Monotone cubic radii: smooth shoulders without overshoot at the base."""
    x=np.array([p[0] for p in keys]);y=np.array([p[1] for p in keys])
    h=np.diff(x);d=np.diff(y)/h;m=np.zeros(len(keys))
    for i in range(1,len(keys)-1):
        if d[i-1]*d[i]>0:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
            m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i])
    result=[]
    for i in range(len(keys)-1):
        for j in range(steps):
            t=j/steps
            r=(2*t**3-3*t*t+1)*y[i]+(t**3-2*t*t+t)*h[i]*m[i]+(-2*t**3+3*t*t)*y[i+1]+(t**3-t*t)*h[i]*m[i+1]
            result.append((float(x[i]+t*h[i]),float(r)))
    return result+[keys[-1]]


def _data_map(a,name,values):
    if values.ndim==2:values=np.repeat(values[:,:,None],3,axis=2)
    h,w,_=values.shape
    image=bpy.data.images.new(name,width=w,height=h,alpha=True)
    image.colorspace_settings.name='Non-Color'
    rgba=np.ones((h,w,4),dtype=np.float32);rgba[:,:,:3]=np.clip(values,0,1)
    image.pixels.foreach_set(rgba.ravel());image.pack()
    return image


def _normal(height,strength):
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*.5*strength
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*.5*strength
    n=np.stack((-dx,-dy,np.ones_like(dx)),axis=-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return n*.5+.5


def _texture(mat,image,scale=(1,1)):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    tex=nodes.new('ShaderNodeTexImage');tex.image=image
    tex.interpolation='Linear';tex.extension='REPEAT'
    if scale!=(1,1):
        uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value=(*scale,1)
        links.new(uv.outputs['UV'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
    return tex


def _maps(a,mat,name,height,roughness,normal_strength,scale=(1,1)):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
    tex=_texture(mat,_data_map(a,name+'Roughness',roughness),scale)
    links.new(tex.outputs['Color'],bsdf.inputs['Roughness'])
    tex=_texture(mat,_data_map(a,name+'Normal',_normal(height,1)),scale)
    normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=normal_strength
    links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])


def _materials(a):
    rng=np.random.default_rng(943102)
    coat=a.material('BottleCoating',(.012,.017,.02),0,.49)
    bsdf=coat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Coat Weight'].default_value=.035;bsdf.inputs['Coat Roughness'].default_value=.38
    grain=rng.random((512,512)).astype(np.float32)
    # Two physical scales avoid a conspicuous tiled pattern in macro views.
    low=sum(np.roll(np.roll(grain,i,0),j,1) for i,j in [(0,0),(1,0),(-1,0),(0,1),(0,-1)])/5
    _maps(a,coat,'PowderCoat',grain*.45+low*.55,.49+(grain-.5)*.12,.28,(2,2))

    steel=a.material('BrushedStainlessSteel',(.64,.66,.68),1,.34)
    bsdf=steel.node_tree.nodes.get('Principled BSDF')
    for key in ('Anisotropic IOR Level','Anisotropic'):
        if key in bsdf.inputs:bsdf.inputs[key].default_value=.65;break
    if 'Anisotropic Rotation' in bsdf.inputs:bsdf.inputs['Anisotropic Rotation'].default_value=.25
    y,x=np.mgrid[0:512,0:1024]
    fibres=rng.random((512,1))*.45+np.sin(y*2.1+np.sin(x/173)*.4)*.12+rng.random((512,1024))*.05
    _maps(a,steel,'BrushedSteel',fibres,.31+fibres*.13,.18,(2,8))

    wood=a.material('NaturalBamboo',(1,1,1),0,.58)
    size=1024;y,x=np.mgrid[0:size,0:size];u=x/size;v=y/size
    path=y+2*np.sin(u*6.3)+.8*np.sin(u*32+v*5)
    grain=(.016*np.sin(path*.68)+.014*np.sin(path*1.91+np.sin(u*17))+.006*np.sin(path*.087))
    slow=np.repeat(rng.random((size,1))-.5,size,axis=1)*.025
    pores=np.maximum(0,np.sin(path*.49+np.sin(u*9))- .92)**2*.8
    micro=rng.normal(0,.006,(size,size));tone=grain+slow+micro-pores
    rgb=np.array([.76,.57,.33])[None,None,:]+tone[:,:,None]*np.array([1,.77,.47])[None,None,:]
    tex=_texture(wood,a.pixels_image('NaturalBambooColour',np.clip(rgb,0,1)))
    wood.node_tree.links.new(tex.outputs['Color'],wood.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    _maps(a,wood,'BambooFibres',grain*3+micro*.7,.57+grain*.5,.35)
    wood.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.045
    wood.node_tree.nodes.get('Principled BSDF').inputs['Coat Roughness'].default_value=.5
    wire=a.material('PolishedHandleSteel',(.68,.7,.72),1,.23)
    rubber=a.material('Silicone',(.012,.014,.016),0,.78)
    dark=a.material('SoftBlackABS',(.012,.014,.016),0,.61)
    return coat,steel,wood,wire,rubber,dark


def build_bottle(a):
    a.reset();coat,steel,wood,wire,rubber,dark=_materials(a)
    overlay_material=a.material('TransparentDecoration',(1,1,1),0,.5)
    body_keys=[(0,.0318),(.00025,.0326),(.0007,.03345),(.0014,.0342),(.0024,.03472),(.0037,.035),
               (.135,.035),(.142,.03493),(.148,.0342),(.154,.0319),(.160,.0287),(.166,.02435),(.170,.02215),(.173,.0219),(.177,.0219)]
    body_profile=[(0,0)]+_profile(body_keys)
    for pose in ('closed','open','lying'):
        root=a.state(pose);root['quality_version']='v02'
        a.lathe('VacuumBottleBody',body_profile,coat,n=192)
        # Rolled, thin lip and a genuinely open inner wall down to the base.
        neck=[(.171,.02185),(.1845,.02185),(.1858,.02185)]
        for i in range(1,13):
            angle=math.pi*i/12
            neck.append((.1858+.0012*math.sin(angle),.02065+.0012*math.cos(angle)))
        neck+=_profile([(.006,0),(.0068,.0318),(.008,.0327),(.135,.0327),(.151,.029),(.164,.0205),(.171,.01945),(.1858,.01945)],2)[::-1][1:]
        a.lathe('SteelNeckAndInnerWall',neck,steel,n=192)
        # Female thread sits inside the neck, with the same diameter contract.
        thread=[]
        for i in range(193):
            angle=i/192*math.pi*5
            thread.append((.01922*math.cos(angle),.01922*math.sin(angle),.176+i/192*.007))
        a.curve('InternalSteelThread',thread,.00024,steel)
        a.lathe('BaseRim',[(0,.032),(.0002,.0326),(.0006,.033),(.0012,.033)],dark,n=192)
        # The wrap follows exactly the new body profile and retains the old UVs.
        decoration=[(z,r+.000035) for z,r in _profile(body_keys,4) if .0037<=z<=.148]
        decoration=[(.005,.035035)]+[p for p in decoration if p[0]>.005]
        overlay=a.lathe('BottleBodyDecoration',decoration,overlay_material,n=192)
        for loop in overlay.data.loops:
            vertex=overlay.data.vertices[loop.vertex_index]
            overlay.data.uv_layers.active.data[loop.index].uv.y=(vertex.co.z-.005)/.142
        a.print_surface(overlay,'body')
        lid=bpy.data.objects.new('RemovableBambooLid',None);bpy.context.collection.objects.link(lid);lid.parent=root
        before=set(bpy.context.scene.objects)
        collar=[(.184,0),(.184,.0228),(.1841,.02315),(.18435,.02355),(.1847,.02385),(.1852,.024),
                (.1858,.024),(.1968,.024),(.1974,.02394),(.19795,.02375),(.1984,.0234),(.1987,.02295),(.1988,.0225),(.1988,0)]
        a.lathe('LidSteelCollar',collar,steel,n=192)
        top=a.lathe('LidBambooTop',[(.1986,0),(.1986,.0222),(.1988,.0226),(.1991,.0228),(.2003,.0228),(.20065,.02265),(.2009,.0224),(.201,.022),(.201,0)],wood,n=192)
        for loop in top.data.loops:
            v=top.data.vertices[loop.vertex_index].co
            top.data.uv_layers.active.data[loop.index].uv=(v.x/.046+.5,v.y/.046+.5)
        a.lathe('LidThreadPlug',[(.161,0),(.161,.0177),(.1613,.0183),(.162,.01875),(.1627,.019),(.1804,.019),(.1813,.0193),(.182,.0202),(.183,.021),(.184,.021)],steel,n=192)
        for z in (.167,.174):
            seal=[(z+.001*math.sin(t),.019+.0008*math.cos(t)) for t in np.linspace(-math.pi/2,math.pi/2,13)]
            a.lathe('LidSiliconeSeal',seal,rubber,n=192)
        thread=[]
        for i in range(129):
            angle=i/128*math.pi*4
            thread.append((.0191*math.cos(angle),.0191*math.sin(angle),.177+i/128*.006))
        a.curve('CapThreadDetail',thread,.00022,steel)
        points=[(-.025,0,.191),(-.026,0,.1985)]
        for i in range(65):
            angle=math.pi-i/64*math.pi
            points.append((.026*math.cos(angle),0,.1985+.0102*math.sin(angle)))
        points.append((.025,0,.191))
        handle=a.curve('SteelCarryHandle',points,.00103,wire)
        for face in handle.data.polygons:face.use_smooth=True
        for side in (-1,1):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(side*.0244,0,.1915))
            rivet=bpy.context.object;rivet.name='HandlePivotRivet';rivet.scale=(.00125,.0021,.0021)
            a.attach(rivet,wire)
            for face in rivet.data.polygons:face.use_smooth=True
        a.plane('BambooTopDecoration',(0,0,.201025),.035,.035,overlay_material,'lid','top')
        for obj in set(bpy.context.scene.objects)-before:obj.parent=lid
        if pose=='open':lid.location=(.072,-.012,-.161)
        if pose=='lying':root.rotation_euler=(0,math.pi/2,0);root.location.z=.035
    # Three poses describe one manufactured object. Share identical mesh data
    # without sharing transforms or print-surface extras between state nodes.
    cache={}
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH':continue
        data=obj.data;vertices=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',vertices)
        loops=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',loops)
        counts=np.empty(len(data.polygons),dtype=np.int32);data.polygons.foreach_get('loop_total',counts)
        uv=np.empty(len(data.loops)*2,dtype=np.float32)
        if data.uv_layers.active:data.uv_layers.active.data.foreach_get('uv',uv)
        else:uv.fill(0)
        digest=hashlib.sha256(vertices.tobytes()+loops.tobytes()+counts.tobytes()+uv.tobytes()+'|'.join(m.name for m in data.materials).encode()).hexdigest()
        if digest in cache:obj.data=cache[digest]
        else:cache[digest]=data
    a.export('bottle','MO9431 V02; catalogue dimensions retained; ImageGen-guided smooth profiles, rolled lip, threads, rivets, embedded powder-coat / brushed-steel / bamboo PBR; identical mesh buffers shared by the three pose nodes. Secondary dimensions remain a visual reconstruction.',source_name='prepared-v02.blend')
