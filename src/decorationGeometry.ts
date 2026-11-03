import { BufferGeometry, PlaneGeometry, Vector3 } from 'three'

/** A shallow resin dome on the original lid's UV plane, in asset metres. */
export function domingGeometry(source:BufferGeometry):BufferGeometry {
  const positions=source.getAttribute('position'),uv=source.getAttribute('uv')
  const point=(u:number,v:number)=>{
    for(let i=0;i<uv.count;i++)if(Math.abs(uv.getX(i)-u)<.001&&Math.abs(uv.getY(i)-v)<.001)return new Vector3().fromBufferAttribute(positions,i)
    throw new Error('Doming requires a rectangular lid UV surface')
  }
  const origin=point(0,0),u=point(1,0).sub(origin),v=point(0,1).sub(origin)
  const normal=new Vector3().fromBufferAttribute(source.getAttribute('normal'),0).normalize()
  const geometry=new PlaneGeometry(1,1,48,48)
  const p=geometry.getAttribute('position'),coords=geometry.getAttribute('uv')
  for(let i=0;i<p.count;i++){
    const x=coords.getX(i),y=coords.getY(i)
    const radius=(x-.5)**2*4+(y-.5)**2*4
    const lift=.0002+.001*Math.sqrt(Math.max(0,1-radius))
    const next=origin.clone().addScaledVector(u,x).addScaledVector(v,y).addScaledVector(normal,lift)
    p.setXYZ(i,next.x,next.y,next.z)
  }
  if(new Vector3().crossVectors(u,v).dot(normal)<0){
    const indices=geometry.getIndex()!
    for(let i=0;i<indices.count;i+=3){const a=indices.getX(i);indices.setX(i,indices.getX(i+1));indices.setX(i+1,a)}
  }
  geometry.computeVertexNormals()
  return geometry
}
