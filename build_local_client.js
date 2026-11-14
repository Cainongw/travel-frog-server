'use strict';

// Reproducible transformations on a new apktool output directory only.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||'exports/local-apk-build/decoded');
const source=path.resolve('exports/oneplus-official-20261114-final/internal/files/games/https/ali-lxqw-hotfix.ejoy.com/c1_client/release/lingxi/android');
const packageName='com.cainong.travelfrog.local';
const account=process.env.FROG_ACCOUNT || 'guest';
const manifestFile=path.join(root,'AndroidManifest.xml');
let xml=fs.readFileSync(manifestFile,'utf8');
if(!xml.includes('package="com.ali.croak.mi"'))throw Error('Expected original APK package');
xml=xml.replace('package="com.ali.croak.mi"',`package="${packageName}"`).replace('android:label="@string/app_name"','android:label="旅行青蛙·本地版"');
xml=xml.replace(/android:authorities="([^"]+)"/g,(_,s)=>`android:authorities="${s.replaceAll('com.ali.croak.mi',packageName)}"`);
const permissions=[...xml.matchAll(/<permission\b[^>]*android:name="([^"]+)"/g)].map(m=>m[1]);
for(const permission of permissions)if(permission.startsWith('com.ali.croak.mi'))xml=xml.replaceAll(`"${permission}"`,`"${permission.replace('com.ali.croak.mi',packageName)}"`);
xml=xml.replaceAll('android:scheme="ejoysdk"','android:scheme="froglocal"');
fs.writeFileSync(manifestFile,xml);
const game=path.join(root,'assets/game');
fs.cpSync('exports/oneplus-official-20261114-live/assets',path.join(game,'resource/China'),{recursive:true});
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(p,x.name)):[path.join(p,x.name)]);}
const latest=new Map();
for(const p of walk(source)){
 const m=p.replaceAll('\\','/').match(/android\/(\d+)\/(js\/[^#]+)#\/([^/]+)$/);
 if(m&&!m[3].endsWith('#header')&&(!latest.has(m[2])||latest.get(m[2]).version<+m[1]))latest.set(m[2],{p,version:+m[1]});
}
for(const [relative,{p}]of latest)fs.copyFileSync(p,path.join(game,relative));
const mainFile=path.join(game,'js/main.min.js');let main=fs.readFileSync(mainFile,'utf8');
for(const [from,to]of [
 ['i=e.channelType,i>ChannelType.Undefined','i=1,i>ChannelType.Undefined'],
 ['GameConfig.serverList=n.gameServer','GameConfig.serverList=["ws://127.0.0.1:8080"]'],
]){if(main.split(from).length!==2)throw Error('Unexpected JS patch point: '+from);main=main.replace(from,to);}
main+=`\n;(function(){
 GameConfig.channel=ChannelType.Test;
 TestChannel.prototype.login=function(done){core.ModelManage.getInstance().getModel(UserModel).setUserInfo({userId:${JSON.stringify(account)}});if(done)done();};
 Main.prototype.closeLog=function(){};
 UpdateViewController.prototype.checkUpdate=function(){this.offset={};return Promise.resolve();};
 console.log('FROG_LOCAL_CLIENT_READY com.cainong.travelfrog.local');
})();\n`;
fs.writeFileSync(mainFile,main);
const mdir=path.join(source,'manifest.1.0.20.json#'),mpath=fs.readdirSync(mdir).find(x=>!x.endsWith('#header'));
const manifest=JSON.parse(fs.readFileSync(path.join(mdir,mpath)));
const decode=s=>s.match(/.{4}/g).map(x=>String.fromCharCode(parseInt(x,16))).join('');
const encode=s=>[...s].map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
const config=JSON.parse(decode(manifest.code));config.channelType=1;config.gameServer=['ws://127.0.0.1:8080'];config.printLog=true;config.showLog=false;
manifest.code=encode(JSON.stringify(config));manifest.game=['js/default.thm.js','js/main.min.js'];manifest.res='local-patch.json';manifest.thm='resource/China/default.thm.json';
fs.writeFileSync(path.join(game,'manifest.json'),JSON.stringify(manifest));
fs.writeFileSync(path.join(game,'local-patch.json'),'{}');
let index=fs.readFileSync(path.join(game,'index.html'),'utf8');
index=index.replace(/loadSingleScript\("https:[^;]+;/,'loadSingleScript("local-launcher.js");');
fs.writeFileSync(path.join(game,'index.html'),index);
const ldir=path.join(source,'launcherv2.js#'),lpath=fs.readdirSync(ldir).find(x=>!x.endsWith('#header'));let launcher=fs.readFileSync(path.join(ldir,lpath),'utf8');
const point=launcher.indexOf('loadLocalManifest(function(local)');if(point<0)throw Error('Launcher start not found');
launcher=launcher.slice(0,point)+`window.cdn='';window.launchInfo='local_archive';onHttpLoad(${JSON.stringify(manifest)});`;
fs.writeFileSync(path.join(game,'local-launcher.js'),launcher);
console.log({packageName,root,updatedScripts:latest.size,entry:'local-launcher.js',account});
