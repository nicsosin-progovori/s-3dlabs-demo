"""Bounded operator probe: real 1600px PNG from an isolated local candidate."""
import datetime
import hashlib
import json
import os
import pathlib
import struct
import time
import urllib.request
import zlib

def image_statistics(png):
    """Decode the browser's RGB(A) PNG, including all five PNG row filters."""
    position=8;compressed=[]
    while position<len(png):
        size=struct.unpack('>I',png[position:position+4])[0]
        kind=png[position+4:position+8];data=png[position+8:position+8+size]
        if kind==b'IHDR':width,height,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',data)
        if kind==b'IDAT':compressed.append(data)
        position+=size+12
    if depth!=8 or color not in (2,6) or interlace!=0:raise RuntimeError('Unsupported probe PNG format')
    channels=3 if color==2 else 4;stride=width*channels
    raw=zlib.decompress(b''.join(compressed));previous=bytearray(stride);at=0;nonblack=0;magenta=0
    for _ in range(height):
        filter_type=raw[at];at+=1;row=bytearray(raw[at:at+stride]);at+=stride
        if filter_type not in range(5):raise RuntimeError('Invalid PNG filter')
        for i in range(stride):
            left=row[i-channels] if i>=channels else 0;up=previous[i];corner=previous[i-channels] if i>=channels else 0
            if filter_type==1:prediction=left
            elif filter_type==2:prediction=up
            elif filter_type==3:prediction=(left+up)//2
            elif filter_type==4:
                p=left+up-corner;a=abs(p-left);b=abs(p-up);c=abs(p-corner)
                prediction=left if a<=b and a<=c else up if b<=c else corner
            else:prediction=0
            row[i]=(row[i]+prediction)&255
        for i in range(0,stride,channels):
            r,g,b=row[i:i+3]
            if r+g+b>30:nonblack+=1
            if r>125 and b>125 and r>g*1.7 and b>g*1.7:magenta+=1
        previous=row
    return {'width':width,'height':height,'nonblackPixels':nonblack,'magentaPixels':magenta}

directory=pathlib.Path(__file__).resolve().parent
origin=os.environ.get('BOTTLE_PROBE_ORIGIN','http://172.18.0.4:5180')
edge=int(os.environ.get('BOTTLE_PROBE_EDGE','1600'))
if not 64<=edge<=2048:raise RuntimeError('Invalid probe size')
camera=json.loads((directory/'benchmark-camera.json').read_text())
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':False}
try:
    with urllib.request.urlopen(origin+'/api/scenes/default',timeout=10) as response:
        raw=response.read();profile=json.loads(raw)
    scene={'id':profile['id'],'revision':profile['revision'],'sha256':hashlib.sha256(raw).hexdigest()}
    logos=sorted(pathlib.Path('/var/lib/3dlabs/logos').glob('*.png'))
    if not logos:raise RuntimeError('Operator SVG must be uploaded first')
    data=logos[0].read_bytes();width,height=struct.unpack('>II',data[16:24])
    logo={'kind':'uploaded','sha256':hashlib.sha256(data).hexdigest(),'width':width,'height':height}
    composition=json.loads((directory/'benchmark-composition.json').read_text())
    job={'version':5,'product':'bottle','state':'open','skin':{'id':'bottle-red','revision':'v01'},'scene':scene,'camera':camera,'image':{'width':edge,'height':edge},'composition':composition,'decoration':{'enabled':True,'surface':'body','technique':'digital','colors':1,'logo':logo}}
    (directory/'benchmark-job.json').write_text(json.dumps(job))
    request=urllib.request.Request(origin+'/api/render',data=json.dumps(job).encode(),headers={'Content-Type':'application/json'},method='POST')
    started=time.monotonic()
    with urllib.request.urlopen(request,timeout=115) as response:
        image=response.read();headers=dict(response.headers)
    if image[:8]!=bytes.fromhex('89504e470d0a1a0a'):raise RuntimeError('Not a PNG')
    if struct.unpack('>II',image[16:24])!=(edge,edge):raise RuntimeError('PNG size mismatch')
    (directory/'benchmark-server.png').write_bytes(image)
    seconds=time.monotonic()-started
    statistics=image_statistics(image);result.update(seconds=seconds,bytes=len(image),headers=headers,statistics=statistics)
    if statistics['nonblackPixels']<edge*edge*.5:raise RuntimeError('Mostly black PNG')
    if statistics['magentaPixels']<100:raise RuntimeError('Uploaded magenta logo is absent from PNG')
    result.update(passed=True)
except Exception as error:
    result.update(error=type(error).__name__,message=str(error))
    if hasattr(error,'read'):result['response']=error.read(4096).decode(errors='replace')
finally:
    (directory/'benchmark-result.json').write_text(json.dumps(result,indent=2))
