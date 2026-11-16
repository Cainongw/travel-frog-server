'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readBundle,resourceImage,loadCatalog}=require('../../src/core/catalog');
const {PROJECT_ROOT}=require('../../src/paths');
function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)]);}
function build(root,internalRoot=path.join(root,'internal')){
  root=path.resolve(PROJECT_ROOT,root);internalRoot=path.resolve(PROJECT_ROOT,internalRoot);
  const target=path.resolve(root,'assets'),cache=path.resolve(internalRoot,'files/games/https/ali-lxqw-hotfix.ejoy.com');
  const files=walk(cache).filter(f=>!f.endsWith('#header')),choices=new Map();
  for(const file of files){
    const slash=file.replaceAll('\\','/'),m=slash.match(/android\/(\d+)\/resource\/China\/(.*?)#\/([^/]+)$/);
    if(!m)continue;
    const prev=choices.get(m[2]);if(!prev||prev.version<Number(m[1]))choices.set(m[2],{file,version:Number(m[1]),hash:m[3]});
  }
  for(const [rel,entry]of choices){const out=path.resolve(target,rel);if(!out.startsWith(target+path.sep))throw Error('Unsafe path');fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(entry.file,out);}
  const config=readBundle(path.join(target,'eab/config.eab'));
  const cap=JSON.parse(fs.readFileSync(path.join(root,'capture-final.json')));
  const pictures=[];
  for(const rows of Object.values(cap.responses))for(const row of rows){for(const p of Array.isArray(row.data?.pic_list)?row.data.pic_list:Array.isArray(row.data?.pictures)?row.data.pictures:[])if(p.layers)pictures.push(p);}
  const ids=[...new Set(pictures.flatMap(p=>p.layers.map(l=>l.layer[0])))],missing=[];
  const catalog=loadCatalog(target);
  for(const id of ids){try{const b=resourceImage(catalog,id);if(b.subarray(0,4).toString('hex')!=='89504e47')throw Error('Not PNG');}catch(error){missing.push({id,resource:config.resources_json[id],error:error.message});}}
  const report={assetRoot:target,hot_updates:choices.size,postcard_resources:ids.length,missing,files:walk(target).length};
  fs.writeFileSync(path.join(root,'asset-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  return report;
}
if(require.main===module){const args=process.argv.slice(2),input=args.filter(x=>!x.startsWith('--'));if(!input[0])throw Error('usage: node tools/official/official_assets.js capture-root [internal-root] [--check]');const root=path.resolve(PROJECT_ROOT,input[0]);if(args.includes('--check')){const internal=path.resolve(PROJECT_ROOT,input[1]||path.join(root,'internal'));for(const file of [internal,path.join(root,'capture-final.json')])if(!fs.existsSync(file))throw Error('Missing asset build input: '+file);console.log(JSON.stringify({checked:true,root,internal,catalog:require.resolve('../../src/core/catalog')}));}else build(root,input[1]);}
module.exports={build};
