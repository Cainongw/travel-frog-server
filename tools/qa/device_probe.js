'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const {PROJECT_ROOT}=require('../../src/paths');
const adb=process.env.FROG_ADB||'G:/platform-tools/adb.exe',serial=process.env.FROG_DEVICE;
function run(args){if(!serial)throw Error('Set FROG_DEVICE to the adb device serial');const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:10000000});if(r.error)throw r.error;if(r.status)throw Error(r.stderr||r.stdout);return r.stdout;}
function runRoot(command){return run(['shell',"su -c '"+command.replaceAll("'","'\\''")+"'"]);}
async function main(){
 const args=process.argv.slice(2),input=args.find(x=>!x.startsWith('--'));if(!input)throw Error('usage: node tools/qa/device_probe.js actions.json [--check]');
 const file=path.resolve(PROJECT_ROOT,input),actions=JSON.parse(fs.readFileSync(file));if(!Array.isArray(actions))throw Error('Probe actions must be an array');
 const id=crypto.randomUUID(),root=path.join(PROJECT_ROOT,'exports/device-tests');if(args.includes('--check')){console.log(JSON.stringify({checked:true,input:file,root,adb,serial,actions:actions.length}));return;}fs.mkdirSync(root,{recursive:true});const queue=path.join(root,id+'.command.json');fs.writeFileSync(queue,JSON.stringify({id,actions}));
 run(['push',queue,'/data/local/tmp/frog-qa-command.json']);runRoot('cp /data/local/tmp/frog-qa-command.json /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-command.json; chmod 644 /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-command.json');
 const deadline=Date.now()+Math.max(30000,actions.length*10000);
 while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));let data;try{data=JSON.parse(run(['shell',"su -c 'cat /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-result.json'"]));}catch{continue;}if(data.id===id){const file=path.join(root,id+'.result.json');fs.writeFileSync(file,JSON.stringify(data,null,2));console.log(JSON.stringify({file,results:data.results.map(x=>({code:x?.code,error:x?.error,timeout:x?.timeout,opened:x?.opened,closed:x?.closed,fields:Object.keys(x||{})})),protocolEvents:data.protocols.length}));return;}}
 throw Error('Device probe timed out; inspect current game state and logs');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
