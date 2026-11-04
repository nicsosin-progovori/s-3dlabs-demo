import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'

/** Opt-in local QA: observe the rendered camera without changing the clock. */
export function MotionAudit(){
  const {gl,camera}=useThree(),frames=useRef<object[]>([]),last=useRef(0)
  const idle=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),request=useRef<string|null>(null)
  const video=useRef<{recorder:MediaRecorder;stream:MediaStream;chunks:BlobPart[];serial:string}|null>(null)
  const session=useRef<symbol|null>(null)
  const record=new URLSearchParams(location.search).has('recordMotion')
  useEffect(()=>{
    session.current=Symbol();delete gl.domElement.dataset.motionVideo;delete gl.domElement.dataset.motionVideoProduct
    return()=>{session.current=null;clearTimeout(idle.current);if(video.current?.recorder.state==='recording')video.current.recorder.stop();video.current?.stream.getTracks().forEach(t=>t.stop())}
  },[gl])
  useFrame(()=>{
    const section=gl.domElement.closest('.viewport')
    const now=performance.now(),serial=section?.getAttribute('data-camera-request')??'0'
    if(record&&request.current!==null&&serial!==request.current&&!video.current){
      const stream=gl.domElement.captureStream(60),chunks:BlobPart[]=[],mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t))
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000})
      const token=session.current,product=section?.getAttribute('data-testid')
      video.current={recorder,stream,chunks,serial};delete gl.domElement.dataset.motionVideo
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      recorder.onstop=()=>{
        const reader=new FileReader();reader.onload=()=>{if(token!==session.current)return;gl.domElement.dataset.motionVideo=String(reader.result);gl.domElement.dataset.motionVideoSerial=serial;gl.domElement.dataset.motionVideoProduct=product??''};reader.readAsDataURL(new Blob(chunks,{type:mime}))
        stream.getTracks().forEach(t=>t.stop());video.current=null
      }
      recorder.start()
    }
    request.current=serial
    frames.current.push({time:now,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera instanceof PerspectiveCamera?camera.fov:0,state:section?.getAttribute('data-state'),view:section?.getAttribute('data-view'),request:serial,motion:section?.getAttribute('data-motion'),renderFrames:gl.domElement.dataset.renderFrames})
    if(frames.current.length>1200)frames.current.splice(0,300)
    if(now-last.current>80){last.current=now;gl.domElement.dataset.motionAudit=JSON.stringify(frames.current)}
    clearTimeout(idle.current);idle.current=setTimeout(()=>{gl.domElement.dataset.motionAudit=JSON.stringify(frames.current);if(video.current?.recorder.state==='recording')video.current.recorder.stop()},1100)
  },.5)
  return null
}
