'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {PROJECT_ROOT}=require('../../src/paths');
const args=process.argv.slice(2),checkOnly=args.includes('--check');
const root=path.resolve(PROJECT_ROOT,args.find(x=>!x.startsWith('--'))||'exports/dog-apk-build/decoded');
const tools=path.resolve(PROJECT_ROOT,process.env.FROG_ANDROID_TOOLS||'exports/android-tools'),build=path.resolve(PROJECT_ROOT,process.env.FROG_NATIVE_BUILD||'exports/native-login-build');
const javaSource=path.join(__dirname,'NativeLoginActivity.java');
for(const required of [javaSource,path.join(tools,'android.jar'),path.join(tools,'json.jar'),path.join(tools,'r8.jar'),path.join(root,'AndroidManifest.xml'),path.join(root,'apktool.yml'),path.join(root,'assets/game/js/main.min.js')])if(!fs.existsSync(required))throw Error('Missing native build input: '+required);
for(const name of ['native_login_patch','client_policy_patch','qa_client_hook'])require('./patches/'+name);
if(checkOnly){console.log(JSON.stringify({checked:true,root,tools,build,javaSource,patches:['native_login_patch','client_policy_patch',...(process.env.FROG_QA==='1'?['qa_client_hook']:[])].map(x=>require.resolve('./patches/'+x))},null,2));}
else{
fs.mkdirSync(build,{recursive:true});fs.mkdirSync(path.join(build,'dex'),{recursive:true});
function run(command,args){const r=spawnSync(command,args,{cwd:PROJECT_ROOT,encoding:'utf8',maxBuffer:1000000});if(r.error)throw r.error;if(r.status)throw Error(r.stderr||r.stdout);if(r.stdout)console.log(r.stdout);}
run('javac',['--release','8','-encoding','UTF-8','-classpath',[path.join(tools,'android.jar'),path.join(tools,'json.jar')].join(path.delimiter),'-d',build,javaSource]);
run('jar',['cf',path.join(build,'login.jar'),'-C',build,'com']);
run('java',['-cp',path.join(tools,'r8.jar'),'com.android.tools.r8.D8','--min-api','21','--lib',path.join(tools,'android.jar'),'--classpath',path.join(tools,'json.jar'),'--output',path.join(build,'dex'),path.join(build,'login.jar')]);
fs.copyFileSync(path.join(build,'dex/classes.dex'),path.join(root,'classes4.dex'));
let manifest=fs.readFileSync(path.join(root,'AndroidManifest.xml'),'utf8');
const launch=/<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN"\/>\s*<category android:name="android\.intent\.category\.LAUNCHER"\/>\s*<\/intent-filter>/;
if(!manifest.includes('com.cainong.travelfrog.NativeLoginActivity')){
 if(!launch.test(manifest))throw Error('Original launcher filter not found');
 manifest=manifest.replace(launch,'');
 manifest=manifest.replace('</application>',`<activity android:name="com.cainong.travelfrog.NativeLoginActivity" android:exported="true" android:screenOrientation="portrait" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:windowSoftInputMode="adjustResize"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter><intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="dogfrog" android:host="account"/></intent-filter></activity></application>`);
}
fs.writeFileSync(path.join(root,'AndroidManifest.xml'),manifest);
const file=path.join(root,'assets/game/js/main.min.js');let main=fs.readFileSync(file,'utf8');
const old=main.lastIndexOf('\n;(function gameLoginPatch(');if(old>=0)main=main.slice(0,old);
const native=main.lastIndexOf('\n;(function nativeLoginPatch(');if(native>=0)main=main.slice(0,native);
main+='\n;('+require('./patches/native_login_patch').nativeLoginPatch.toString()+')();\n';
main+='\n;('+require('./patches/client_policy_patch').clientPolicyPatch.toString()+')();\n';
if(process.env.FROG_QA==='1')main+='\n;('+require('./patches/qa_client_hook').qaClientHook.toString()+')();\n';
fs.writeFileSync(file,main);
let yaml=fs.readFileSync(path.join(root,'apktool.yml'),'utf8');yaml=yaml.replace(/versionCode: \d+/,'versionCode: 22').replace(/minSdkVersion: \d+/,'minSdkVersion: 21');fs.writeFileSync(path.join(root,'apktool.yml'),yaml);
console.log('Native Android login and app-private session bridge ready.');
}
