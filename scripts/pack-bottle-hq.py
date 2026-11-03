"""Repack the derived GLB with standard indexed PNGs; no codec extension needed."""
import hashlib
import io
import json
import struct
from pathlib import Path
from PIL import Image,ImageChops,ImageStat

ROOT=Path(__file__).resolve().parent.parent
RAW=ROOT/'.cache/model-build/bottle-hq-v01.glb'
OUT=ROOT/'public/models/bottle/bottle-hq-v01.glb'
raw=RAW.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+length]);binary=raw[28+length:]
replacements={};images=[]
for image in doc['images']:
    view=doc['bufferViews'][image['bufferView']]
    source=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
    im=Image.open(io.BytesIO(source)).convert('RGBA')
    if im.getchannel('A').getextrema()!=(255,255):raise RuntimeError('Unexpected transparent material map')
    rgb=im.convert('RGB')
    palette=rgb.quantize(colors=256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
    buffer=io.BytesIO();palette.save(buffer,format='PNG',optimize=True)
    diff=ImageChops.difference(rgb,palette.convert('RGB'))
    encoded=buffer.getvalue();replacements[image['bufferView']]=encoded
    images.append({'name':image['name'],'width':rgb.width,'height':rgb.height,'beforeBytes':len(source),'bytes':len(encoded),'rms255':ImageStat.Stat(diff).rms,'maxChannelError255':[v[1] for v in diff.getextrema()]})
packed=bytearray()
for i,view in enumerate(doc['bufferViews']):
    while len(packed)%4:packed.append(0)
    data=replacements.get(i,binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])
    view['byteOffset']=len(packed);view['byteLength']=len(data);packed.extend(data)
doc['buffers'][0]['byteLength']=len(packed)
doc['asset']['generator']+='; SOURCE optimized geometry and indexed PNG maps'
text=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode()
text+=b' '*((-len(text))%4)
packed.extend(b'\0'*((-len(packed))%4))
total=12+8+len(text)+8+len(packed)
out=struct.pack('<4sII',b'glTF',2,total)+struct.pack('<I4s',len(text),b'JSON')+text+struct.pack('<I4s',len(packed),b'BIN\0')+packed
OUT.write_bytes(out)
geometry=json.loads((ROOT/'models/bottle/hq-v01-geometry.json').read_text())
receipt={**geometry,'glbSha256':hashlib.sha256(out).hexdigest(),'bytes':len(out),'images':images,'imageFormat':'standard indexed PNG; no texture decoder extension','storedStates':['closed'],'runtimeStates':['closed','open','lying'],'units':'metres','canonicalFrame':'glTF Y-up, front +Z; authored pivots and UVs retained'}
(ROOT/'models/bottle/hq-v01.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'bytes':len(out),'triangles':geometry['triangles'],'textureBytes':sum(v['bytes'] for v in images),'images':images}))
