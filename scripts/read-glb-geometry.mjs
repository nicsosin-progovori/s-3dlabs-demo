// Real glTF topology, UVs and skin bindings for geometry/camera checks. Images
// are deliberately omitted; this runs without a browser or a texture decoder.
import {readFile} from 'node:fs/promises'
import {Bone,BufferAttribute,BufferGeometry,DoubleSide,Group,Matrix4,Mesh,MeshBasicMaterial,Skeleton,SkinnedMesh,Triangle,Vector2,Vector3} from 'three'

export async function readGlbGeometry(path){
  const bytes=await readFile(path),length=bytes.readUInt32LE(12)
  const gltf=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length)
  const joints=new Set((gltf.skins??[]).flatMap(s=>s.joints)),nodes=[],pending=[]
  function accessor(id){
    const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]
    const [Type,step,read]={5126:[Float32Array,4,'readFloatLE'],5125:[Uint32Array,4,'readUInt32LE'],5123:[Uint16Array,2,'readUInt16LE'],5121:[Uint8Array,1,'readUInt8']}[a.componentType],data=new Type(a.count*size)
    for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)data[i*size+j]=binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??size*step)+j*step)
    return new BufferAttribute(data,size,a.normalized??false)
  }
  function node(i){
    const n=gltf.nodes[i],o=joints.has(i)?new Bone():new Group();nodes[i]=o;o.name=n.name;o.userData={...n.extras}
    if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale)}
    else {if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale)}
    if(n.mesh!==undefined)for(const p of gltf.meshes[n.mesh].primitives){
      const g=new BufferGeometry()
      for(const [name,key]of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0'],['skinIndex','JOINTS_0'],['skinWeight','WEIGHTS_0']])if(p.attributes[key]!==undefined)g.setAttribute(name,accessor(p.attributes[key]))
      if(p.indices!==undefined)g.setIndex(accessor(p.indices))
      const m=new MeshBasicMaterial({side:DoubleSide}),mesh=n.skin===undefined?new Mesh(g,m):new SkinnedMesh(g,m)
      mesh.userData.print_surface=n.extras?.print_surface;o.add(mesh)
      if(n.skin!==undefined)pending.push([mesh,n.skin])
    }
    for(const c of n.children??[])o.add(node(c));return o
  }
  const root=new Group();for(const i of gltf.scenes[gltf.scene??0].nodes)root.add(node(i));root.updateMatrixWorld(true)
  for(const [mesh,id]of pending){const s=gltf.skins[id],a=accessor(s.inverseBindMatrices).array;mesh.bind(new Skeleton(s.joints.map(i=>nodes[i]),s.joints.map((_,i)=>new Matrix4().fromArray(a,i*16))),new Matrix4())}
  return root
}

export function printMesh(root,surface){
  let result;root.traverse(o=>{if(o instanceof Mesh&&o.userData.print_surface===surface)result=o})
  if(!result)throw Error('Missing print surface: '+surface);return result
}

export function uvPoint(mesh,u,v){
  const {position:p,uv,normal}=mesh.geometry.attributes,index=mesh.geometry.index
  const at=new Vector3(u,v,0),a=new Vector3(),b=new Vector3(),c=new Vector3(),bary=new Vector3()
  for(let i=0;i<(index?.count??p.count);i+=3){
    const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k)
    const coords=ids.map(j=>new Vector2().fromBufferAttribute(uv,j))
    a.set(coords[0].x,coords[0].y,0);b.set(coords[1].x,coords[1].y,0);c.set(coords[2].x,coords[2].y,0)
    if(!Triangle.getBarycoord(at,a,b,c,bary))continue
    if(bary.x<-.00001||bary.y<-.00001||bary.z<-.00001)continue
    const point=new Vector3(),n=new Vector3()
    ids.forEach((j,k)=>{point.addScaledVector(new Vector3().fromBufferAttribute(p,j),bary.getComponent(k));n.addScaledVector(new Vector3().fromBufferAttribute(normal,j),bary.getComponent(k))})
    return {point:point.applyMatrix4(mesh.matrixWorld),normal:n.transformDirection(mesh.matrixWorld)}
  }
  throw Error(`UV ${u},${v} is outside ${mesh.parent.name}`)
}

export function physicalMeshes(root){
  const meshes=[];root.traverseVisible(o=>{if(o instanceof Mesh&&!o.userData.print_surface){if(o instanceof SkinnedMesh){o.computeBoundingBox();o.computeBoundingSphere()}meshes.push(o)}});return meshes
}
