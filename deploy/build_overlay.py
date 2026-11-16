"""Offline OCI source overlay for an existing Docker-save runtime image.

Use only when runtime dependencies have not changed; normal builds use Dockerfile.
Does not push, execute containers, or read credentials.
"""
import argparse
import datetime
import hashlib
import io
import json
import tarfile

parser=argparse.ArgumentParser()
for arg in ['base','patch','source_tag','tag','output']:
    parser.add_argument('--'+arg.replace('_','-'),required=True)
args=parser.parse_args()
digest=lambda value:hashlib.sha256(value).hexdigest()
with tarfile.open(args.base) as old,tarfile.open(args.patch) as source:
    entry=next(x for x in json.load(old.extractfile('manifest.json')) if args.source_tag in x.get('RepoTags',[]))
    config=json.load(old.extractfile(entry['Config']))
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w') as layer:
        for member in source.getmembers():
            if not member.isfile():
                continue
            name=member.name.removeprefix('./')
            if '/' in name or not(name.endswith('.js') or name in ['package.json','package-lock.json']):
                raise ValueError('Unexpected source patch path: '+name)
            data=source.extractfile(member).read()
            if name=='package.json':
                package=json.loads(data)
                if package.get('dependencies')!={'openid-client':'^6.9.0'}:
                    raise ValueError('Runtime dependencies changed; rebuild with Dockerfile')
            info=tarfile.TarInfo('app/'+name)
            info.size=len(data)
            info.mode=0o644
            info.uid=info.gid=1000
            layer.addfile(info,io.BytesIO(data))
    data=buffer.getvalue()
    sha=digest(data)
    config['rootfs']['diff_ids'].append('sha256:'+sha)
    config.setdefault('history',[]).append({'created':datetime.datetime.now(datetime.timezone.utc).isoformat(),'created_by':'Travel Frog source overlay; unchanged pinned runtime dependencies'})
    cfg=json.dumps(config,separators=(',',':')).encode()
    cfgsha=digest(cfg)
    layers=[]
    for name in entry['Layers']:
        info=old.getmember(name)
        meta=entry.get('LayerSources',{}).get('sha256:'+name.rsplit('/',1)[-1],{})
        layers.append({'mediaType':meta.get('mediaType','application/vnd.oci.image.layer.v1.tar'),'digest':'sha256:'+name.rsplit('/',1)[-1],'size':info.size})
    layers.append({'mediaType':'application/vnd.oci.image.layer.v1.tar','digest':'sha256:'+sha,'size':len(data)})
    manifest=json.dumps({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':{'mediaType':'application/vnd.oci.image.config.v1+json','digest':'sha256:'+cfgsha,'size':len(cfg)},'layers':layers},separators=(',',':')).encode()
    msha=digest(manifest)
    index=json.dumps({'schemaVersion':2,'manifests':[{'mediaType':'application/vnd.oci.image.manifest.v1+json','digest':'sha256:'+msha,'size':len(manifest),'annotations':{'io.containerd.image.name':args.tag,'org.opencontainers.image.ref.name':args.tag},'platform':{'os':'linux','architecture':'amd64'}}]}).encode()
    with tarfile.open(args.output,'w') as output:
        for member in old.getmembers():
            if member.name in ['index.json','manifest.json','oci-layout']:
                continue
            output.addfile(member,old.extractfile(member) if member.isfile() else None)
        for name,value in [('oci-layout',b'{"imageLayoutVersion":"1.0.0"}'),('index.json',index),('blobs/sha256/'+sha,data),('blobs/sha256/'+cfgsha,cfg),('blobs/sha256/'+msha,manifest)]:
            info=tarfile.TarInfo(name)
            info.size=len(value)
            info.mode=0o644
            output.addfile(info,io.BytesIO(value))
    print(json.dumps({'tag':args.tag,'digest':'sha256:'+msha,'output':args.output}))
