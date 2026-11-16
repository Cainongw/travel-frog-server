'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {shell,capture}=require('./device_backup');
const {PROJECT_ROOT}=require('../../src/paths');
const root=path.resolve(PROJECT_ROOT,process.env.FROG_CAPTURE_ROOT||'exports/oneplus-official-20261114-live');
const relative='files/games/https/ali-lxqw-hotfix.ejoy.com/c1_client/release/lingxi/android/1083/js/main.min.js#/9161863afd5844ef5bc1cea9e59d45e2';
const device='/data/user/0/com.ali.croak.mi/'+relative;
const original=path.join(root,'internal',relative);
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const adb=process.env.FROG_ADB||'G:/platform-tools/adb.exe',serial=process.env.FROG_DEVICE;
function push(p,remote){const r=spawnSync(adb,['-s',serial,'push',p,remote],{encoding:'utf8'});if(r.status)throw Error(r.stderr);}
async function main(){
 const hook=path.join(__dirname,'official_capture_hook.js');
 if(process.argv.includes('--check')){for(const file of [original,hook])if(!fs.existsSync(file))throw Error('Missing capture input: '+file);console.log(JSON.stringify({checked:true,root,original,hook,adb,deviceConfigured:!!serial}));return;}
 if(!serial)throw Error('Set FROG_DEVICE before modifying the official capture hook');
 const expected=crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex');
 if(process.argv[2]==='restore'){
  push(original,'/data/local/tmp/frog-capture-original.js');
  shell(`cat /data/local/tmp/frog-capture-original.js > ${q(device)}`);
  if(!shell(`sha256sum ${q(device)}`).startsWith(expected))throw Error('Restoration hash mismatch');
  console.log('Original script restored and SHA256 verified');return;
 }
 const currentHash=shell(`sha256sum ${q(device)}`);
 const previousPatch=path.join(root,'capture-main.js');
 const patchHash=fs.existsSync(previousPatch)?crypto.createHash('sha256').update(fs.readFileSync(previousPatch)).digest('hex'):'';
 if(!currentHash.startsWith(expected)&&!(patchHash&&currentHash.startsWith(patchHash)))throw Error('Device script changed since backup');
 const source=fs.readFileSync(original,'utf8');
 if(!source.includes('prototype.AnalysisProtocol=function')||!source.includes('e.PlatformFile=t'))throw Error('Unsupported runtime');
 shell('am force-stop com.ali.croak.mi');
 if(!fs.existsSync(path.join(root,'internal-stopped.tar'))){
 const stable=await capture('tar -C /data/user/0/com.ali.croak.mi -cf - .',path.join(root,'internal-stopped.tar'));
 fs.writeFileSync(path.join(root,'internal-stopped.manifest.json'),JSON.stringify(stable,null,2),{flag:'wx'});
 if(stable.exit_code!==0)throw Error('Stopped backup failed');
 }
 const patched=path.join(root,'capture-main.js');
 fs.writeFileSync(patched,source+'\n;'+fs.readFileSync(hook,'utf8'));
 push(patched,'/data/local/tmp/frog-capture-main.js');
 shell(`cat /data/local/tmp/frog-capture-main.js > ${q(device)}`);
 console.log(shell('am start -n com.ali.croak.mi/com.Aligames.lxqw.MainActivity'));
 console.log('Export hook enabled, official channel/endpoints unchanged');
}
main().catch(e=>{console.error(e);process.exitCode=1});
