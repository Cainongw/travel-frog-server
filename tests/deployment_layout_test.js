'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawnSync,spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
function temp(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'frog-deployment-layout-'));t.after(()=>{const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('frog-deployment-layout-'))throw Error('Unsafe fixture cleanup target');fs.rmSync(resolved,{recursive:true,force:true});});return directory;}

test('offline server/admin overlays accept only deployment files, reject escape/secret/link inputs and retain runtime lock',t=>{
 const directory=temp(t);
 const script=String.raw`
import hashlib,importlib.util,io,json,pathlib,tarfile,types,sys
root=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);spec=importlib.util.spec_from_file_location('overlay',root/'deploy/build_overlay.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def tar_bytes(files):
 buffer=io.BytesIO()
 with tarfile.open(fileobj=buffer,mode='w') as archive:
  for name,data in files.items():
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
 return buffer.getvalue()
def make_patch(files,name='patch.tar'):
 filename=work/name;filename.write_bytes(tar_bytes(files));return str(filename)
package={'name':'fixture','version':'0.12.0','dependencies':m.DEPENDENCIES}
lock={'packages':{'':{'dependencies':m.DEPENDENCIES},'node_modules/openid-client':{'version':'6.9.0','integrity':'fixture'}}}
files={'server.js':b"require('./src/server');",'start_admin.js':b"require('./src/server');",'src/server.js':b"require('./paths');",'src/paths.js':b"module.exports={};",'package.json':json.dumps(package).encode(),'package-lock.json':json.dumps(lock).encode()}
base_layer=tar_bytes({'app/package-lock.json':json.dumps(lock).encode(),'app/build_local_client.js':b'old tool','app/admin_test.js':b'old test','app/database.js':b'old module','app/data/postcards.json':b'old demo seed','var/lib/dpkg/info/base:amd64.list':b'legitimate Linux filename'})
layer_hash=hashlib.sha256(base_layer).hexdigest();config=json.dumps({'rootfs':{'type':'layers','diff_ids':['sha256:'+layer_hash]},'config':{'Cmd':['node','server.js']}}).encode();cfg_hash=hashlib.sha256(config).hexdigest();layer_path='blobs/sha256/'+layer_hash;cfg_path='blobs/sha256/'+cfg_hash
manifest=[{'Config':cfg_path,'RepoTags':['fixture:base'],'Layers':[layer_path]}]
base=work/'base.tar';base.write_bytes(tar_bytes({'manifest.json':json.dumps(manifest).encode(),cfg_path:config,layer_path:base_layer}))
def build(patch,kind,name):
 return m.build(types.SimpleNamespace(base=str(base),patch=patch,source_tag='fixture:base',tag='fixture:'+kind,output=str(work/name),kind=kind))
result=build(make_patch(files),'server','server.tar');assert result['removed_legacy_js']==3
with tarfile.open(work/'server.tar') as output:
 index=json.load(output.extractfile('index.json'));digest=index['manifests'][0]['digest'].split(':')[1];manifest=json.load(output.extractfile('blobs/sha256/'+digest));last=manifest['layers'][-1]['digest'].split(':')[1]
 with tarfile.open(fileobj=output.extractfile('blobs/sha256/'+last)) as layer:
  names=layer.getnames();assert 'app/src/server.js' in names;assert 'app/.wh.build_local_client.js' in names;assert 'app/.wh.admin_test.js' in names;assert 'app/src/.wh..wh..opq' in names;assert layer.extractfile('app/data/postcards.json').read()==b'[]\n'
  assert all(n.startswith('app/src/') or n.startswith('app/.wh.') or n in ['app/data/.wh..wh..opq','app/data/postcards.json'] or n[4:] in m.ROOT_FILES for n in names)
for malicious in ['../outside.js','/root/secret.js','src/../../secret.js','src\\core\\secret.js','src/secrets/password.js','src/credentials.js','src/core/oauth_secret.js','src/core/private_key.js','src/core/settings.local.js','src/core/key.pem','tools/build.js','data/save.sqlite','admin_auth.js']:
 broken=dict(files);broken[malicious]=b'forbidden'
 try:build(make_patch(broken),'server','bad.tar')
 except ValueError:pass
 else:raise AssertionError('accepted forbidden path '+malicious)
link=work/'link.tar'
with tarfile.open(link,'w') as archive:
 info=tarfile.TarInfo('src/core/linked.js');info.type=tarfile.SYMTYPE;info.linkname='/root/secret';archive.addfile(info)
try:build(str(link),'server','bad-link.tar')
except ValueError:pass
else:raise AssertionError('accepted symlink')
broken=dict(files);changed=json.loads(json.dumps(lock));changed['packages']['node_modules/openid-client']['version']='99.0.0';broken['package-lock.json']=json.dumps(changed).encode()
try:build(make_patch(broken),'server','bad-lock.tar')
except ValueError as error:assert 'lock' in str(error)
else:raise AssertionError('accepted changed installed dependency')
broken=dict(files);broken.pop('src/paths.js')
try:build(make_patch(broken),'server','incomplete.tar')
except ValueError:pass
else:raise AssertionError('accepted incomplete runtime closure')
admin={'index.html':b'<script src="/admin/assets/app.js"></script>','assets/app.js':b'console.log("built");','assets/style.css':b'body{}','assets/icon.png':b'png fixture'}
build(make_patch(admin),'admin','admin.tar')
with tarfile.open(work/'admin.tar') as output:
 index=json.load(output.extractfile('index.json'));manifest=json.load(output.extractfile('blobs/sha256/'+index['manifests'][0]['digest'].split(':')[1]));last=manifest['layers'][-1]['digest'].split(':')[1]
 with tarfile.open(fileobj=output.extractfile('blobs/sha256/'+last)) as layer:
  assert 'usr/share/nginx/html/admin/.wh..wh..opq' in layer.getnames();assert 'usr/share/nginx/html/admin/assets/app.js' in layer.getnames()
for forbidden in ['package.json','src/main.js','assets/app.js.map','assets/credentials.js','assets/secret.local.js','assets/key.pem','assets/exports/personal.png','../../outside.html']:
 bad=dict(admin);bad[forbidden]=b'forbidden'
 try:build(make_patch(bad),'admin','bad-admin.tar')
 except ValueError:pass
 else:raise AssertionError('accepted forbidden admin asset '+forbidden)
print(json.dumps({'serverSourceFiles':result['source_files'],'serverAndAdminOverlayChecks':True}))
`;
 const result=spawnSync('python',['-',ROOT,directory],{input:script,encoding:'utf8',timeout:30000,maxBuffer:200000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(result.status,0,result.stderr||result.stdout);assert.equal(JSON.parse(result.stdout).serverAndAdminOverlayChecks,true);
});

test('Docker runtime copies only stable entries and src while source-data/tool files remain out of context',()=>{
 const docker=fs.readFileSync(path.join(ROOT,'Dockerfile'),'utf8'),ignore=fs.readFileSync(path.join(ROOT,'.dockerignore'),'utf8');
 assert.match(docker,/COPY server\.js start_admin\.js \.\//);assert.match(docker,/COPY src\/ \.\/src\//);assert.ok(!docker.includes('COPY *.js'));assert.ok(!docker.includes('COPY data/'));
 for(const entry of ['!server.js','!start_admin.js','!src/**/*.js','tools','tests','data','exports','**/*credentials*','**/*.token','**/*.p12'])assert.ok(ignore.split(/\r?\n/).includes(entry),entry);
 assert.ok(!ignore.split(/\r?\n/).includes('!*.js'),'root tool scripts must not be included by wildcard');assert.match(docker,/COPY --from=admin \/build\/admin-ui\/dist \/usr\/share\/nginx\/html\/admin/);
});

test('isolated runtime source tree boots through the stable root entry without old root modules or tools',async t=>{
 const directory=temp(t);for(const name of ['server.js','start_admin.js','package.json','package-lock.json'])fs.copyFileSync(path.join(ROOT,name),path.join(directory,name));fs.cpSync(path.join(ROOT,'src'),path.join(directory,'src'),{recursive:true});fs.mkdirSync(path.join(directory,'data'));fs.writeFileSync(path.join(directory,'data','postcards.json'),'[]');
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:directory,env:{...process.env,FROG_PORT:String(port),FROG_HOST:'127.0.0.1',FROG_DB:path.join(directory,'runtime.sqlite'),FROG_DATA:path.join(directory,'data','postcards.json'),FROG_ASSETS:path.join(directory,'no-personal-assets'),FROG_ADMIN_AUTH:'token',FROG_ADMIN_TOKEN:'deployment-test-token-with-no-real-secret',FROG_ADMIN_UI_ORIGIN:'',FROG_GAME_AUTH_REQUIRED:'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Runtime startup timeout: '+output)),10000);child.once('exit',code=>{clearTimeout(timeout);reject(Error('Runtime exited '+code+': '+output));});child.stdout.on('data',()=>{if(output.includes('SQLite archive:')){clearTimeout(timeout);resolve();}});});
  const response=await fetch(`http://127.0.0.1:${port}/health`);assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.ok(!fs.existsSync(path.join(directory,'database.js')));assert.ok(!fs.existsSync(path.join(directory,'tools')));
 }finally{if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}}
});
