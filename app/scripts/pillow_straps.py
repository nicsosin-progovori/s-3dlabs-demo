"""Reference-based front PU cuffs, buckle plates and two folded adjustment loops."""
import math
import bpy
import numpy as np
from mathutils import Vector,Matrix,Quaternion
from mathutils.geometry import interpolate_bezier

PI=math.pi
g=lambda p:Vector((p[0],-p[2],p[1]))
def smooth(t):
    t=max(0,min(1,t));return t*t*t*(t*(t*6-15)+10)
def cap_at(theta):return math.sqrt(max(0,1-((abs(theta)*180/PI-118)/44)**2)) if abs(theta)>math.radians(118) else 1

def place(api,name,parent,position,x,y,z,feature=None):
    o=api.group(name,parent);a,b,c=g(x),-g(z),g(y)
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Matrix((a,b,c)).transposed().to_quaternion();o.location=g(position)
    if feature:o['pillow_feature']=feature
    return o

def cuff(api,parent,side,pu):
    verts=[];faces=[];uv=[];nu,nv=16,64;theta=side*math.radians(154)
    def point(t,p):return api.body_point(t,p,cap_at(t))
    for layer in [.00035,.00135]:
        for i in range(nu+1):
            t=theta+(i/nu-.5)*.14
            for j in range(nv+1):
                p=math.radians(202+j/nv*162);at=point(t,p);dt=point(t+.0001,p)-point(t-.0001,p);dp=point(t,p+.0001)-point(t,p-.0001)
                verts.append(at+dp.cross(dt).normalized()*layer);uv.append((i/nu*1.8,j/nv*9))
    size=(nu+1)*(nv+1)
    for i in range(nu):
        for j in range(nv):
            a=i*(nv+1)+j;f=(a,a+1,a+nv+2,a+nv+1);faces.append(tuple(reversed(f)));faces.append(tuple(k+size for k in f))
    perimeter=list(range(nv+1))+[i*(nv+1)+nv for i in range(1,nu+1)]+[nu*(nv+1)+j for j in range(nv-1,-1,-1)]+[i*(nv+1) for i in range(nu-1,0,-1)]
    for i,a in enumerate(perimeter):b=perimeter[(i+1)%len(perimeter)];faces.append((a,b,b+size,a+size))
    o=api.mesh('PUFrontAttachmentCuff',verts,faces,pu,parent,uv);o['pillow_attachment_cuff']=side

def button(api,parent,dark):
    verts=[(-.0035,0,.00315)];faces=[];n=48;rings=12;radius=.0035
    for k in range(1,rings+1):
        r=radius*k/rings;z=.00185+.0013*math.sqrt(max(0,1-(k/rings)**2))
        for j in range(n):a=2*PI*j/n;verts.append((-.0035+r*math.cos(a),r*math.sin(a),z))
    for j in range(n):faces.append((0,1+j,1+(j+1)%n))
    for k in range(rings-1):
        for j in range(n):a=1+k*n+j;b=1+k*n+(j+1)%n;faces.append((a,b,b+n,a+n))
    api.mesh('ReleaseButton',verts,faces,dark,parent)

def build_straps(api,parent,pu,edge,plastic,dark):
    straproot=api.group('PillowPULoops',parent,'straps');hardware=api.group('PillowFrontFasteners',parent,'buckle');adjusters=api.group('PillowStrapAdjusters',parent,'adjusters')
    for side in [-1,1]:
        cuff(api,straproot,side,pu)
        theta=side*math.radians(156);surface=api.body_point(theta,math.radians(330),cap_at(theta))
        normal=Vector((side*.28,.12,.95)).normalized();right=Vector((normal.z,0,-normal.x)).normalized();up=normal.cross(right).normalized();centre=surface+normal*.006
        plate=place(api,'LeftBuckle' if side<0 else 'RightBuckle',hardware,centre,right,up,normal,'buckle-left' if side<0 else 'buckle-right')
        api.cube('BucklePUAnchorTab',(0,0,-.003),(.018,.014,.0032),pu,plate,.0007)
        if side<0:
            for x in [-.010,.010]:api.cube('OpenBuckleRail',(x,0,0),(.002,.018,.0032),plastic,plate,.0006)
            for y in [-.0075,.0075]:api.cube('OpenBuckleBridge',(0,y,0),(.022,.003,.0032),plastic,plate,.0006)
            api.cube('BuckleDivider',(0,0,0),(.002,.014,.0032),plastic,plate,.0005);slot=-.005
        else:
            api.cube('ReleaseBuckleBody',(-.0035,0,0),(.015,.017,.0032),plastic,plate,.001)
            api.cube('ReleaseBuckleOuterRail',(.010,0,0),(.002,.017,.0032),plastic,plate,.0006)
            for y in [-.007,.007]:api.cube('ReleaseBuckleSlotBridge',(.0065,y,0),(.009,.003,.0032),plastic,plate,.0005)
            button(api,plate,dark);slot=.0065
        # Two branches are offsets of the same centre surface. They stand on
        # their cut edge, forming a U on the floor like the supplier's photo.
        # This avoids independently drawn curves crossing each other.
        root=centre+right*slot-normal*.004;front=centre+right*slot+normal*.004
        direction=Vector((side*.85,0,-math.sqrt(1-.85**2)));radius=.0095 if side<0 else .011
        floor=Vector((side*.113,.0067,.087));end=floor+direction*.050
        mid=[root.lerp(front,i/12) for i in range(12)]
        mid.extend(interpolate_bezier(front,front+normal*.014,floor-direction*.024,floor,64)[:-1]);floor_index=len(mid)
        mid.extend([floor+direction*(.050*i/44) for i in range(45)])
        tangents=[];base=[];w=up.copy();previous=None;arc=[0]
        for i,p in enumerate(mid):
            if i:arc.append(arc[-1]+(p-mid[i-1]).length)
            t=(mid[min(i+1,len(mid)-1)]-mid[max(0,i-1)]).normalized()
            if previous is not None:w=previous.rotation_difference(t)@w
            w=(w-t*w.dot(t)).normalized();tangents.append(t);base.append(w.copy());previous=t
        t=tangents[floor_index+8];w=base[floor_index+8];desired=Vector((0,1,0));angle=math.atan2(t.dot(w.cross(desired)),w.dot(desired))
        lower=[];upper=[];widths=[];normals=[]
        for i,p in enumerate(mid):
            t=tangents[i];blend=smooth((arc[i]-.010)/max(.001,arc[floor_index]-.010));w=Quaternion(t,angle*blend)@base[i];n=t.cross(w).normalized()
            d=.0009+(radius-.0009)*smooth((arc[i]-.010)/max(.001,arc[floor_index]-.010));p=p.copy();p.y=max(p.y,d*abs(n.y)+.005*abs(w.y)+.00065*abs(n.y)+.0001)
            lower.append(p-n*d);upper.append(p+n*d);widths.append(w);normals.append(n)
        centres=list(lower);axes=list(zip(widths,normals));w=widths[-1];n=normals[-1]
        for phi in np.linspace(-PI/2,PI/2,72)[1:]:
            centres.append(end+direction*(radius*math.cos(phi))+n*(radius*math.sin(phi)))
            tangent=direction*(-math.sin(phi))+n*math.cos(phi);axes.append((w,tangent.cross(w).normalized()))
        centres.extend(reversed(upper[:-1]));axes.extend((widths[i],-normals[i]) for i in range(len(mid)-2,-1,-1))
        verts=[];uv=[];faces=[];mats=[];distance=0
        for i,(p,(w,n)) in enumerate(zip(centres,axes)):
            if i:distance+=(p-centres[i-1]).length
            for off,h in [(-.005,-.00065),(.005,-.00065),(.005,.00065),(-.005,.00065)]:verts.append(p+w*off+n*h);uv.append((off/.008,distance/.008))
        for i in range(len(centres)-1):
            for j in range(4):a=i*4+j;b=i*4+(j+1)%4;faces.append((a,b,b+4,a+4));mats.append(1 if j in [1,3] else 0)
        faces.extend([(3,2,1,0),tuple(range((len(centres)-1)*4,len(centres)*4))]);mats.extend([1,1])
        o=api.mesh('AdjustablePULoop',verts,faces,pu,straproot,uv);o['pillow_strap_side']=side;o['stations']=len(centres);o.data.materials.append(edge)
        for poly,mi in zip(o.data.polygons,mats):poly.material_index=mi
        bpy.context.view_layer.objects.active=o;o.select_set(True);mod=o.modifiers.new('FlatPUFaceNormals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name);o.select_set(False)
        at=floor_index+3;pos=upper[at];axis=(upper[at+1]-upper[at-1]).normalized();across=(widths[at]-axis*widths[at].dot(axis)).normalized();out=axis.cross(across).normalized()
        keeper=place(api,'PUAdjustmentKeeper',adjusters,pos,axis,out,-across)
        for z in [-.0059,.0059]:api.cube('StrapKeeperEdge',(0,0,z),(.005,.0044,.0014),plastic,keeper,.0003)
        for y in [-.0017,.0017]:api.cube('StrapKeeperBridge',(0,y,0),(.005,.001,.013),plastic,keeper,.0003)
