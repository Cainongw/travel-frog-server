'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const adb=process.env.FROG_ADB||'G:/platform-tools/adb.exe',serial=process.env.FROG_DEVICE||'c8e8d4e1';
function run(args){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:10000000});if(r.status)throw Error(r.stderr||r.stdout);return r.stdout;}
function runRoot(command){return run(['shell',"su -c '"+command.replaceAll("'","'\\''")+"'"]);}
async function main(){
 const input=process.argv[2];if(!input)throw Error('usage: node device_probe.js actions.json');
 const actions=JSON.parse(fs.readFileSync(input));const id=crypto.randomUUID(),root=path.resolve('exports/device-tests');fs.mkdirSync(root,{recursive:true});const queue=path.join(root,id+'.command.json');fs.writeFileSync(queue,JSON.stringify({id,actions}));
 run(['push',queue,'/data/local/tmp/frog-qa-command.json']);runRoot('cp /data/local/tmp/frog-qa-command.json /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-command.json; chmod 644 /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-command.json');
 const deadline=Date.now()+Math.max(30000,actions.length*10000);
 while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));let data;try{data=JSON.parse(run(['shell',"su -c 'cat /data/user/0/com.cainong.travelfrog.dog/files/jsdata/frog-qa-result.json'"]));}catch{continue;}if(data.id===id){const file=path.join(root,id+'.result.json');fs.writeFileSync(file,JSON.stringify(data,null,2));console.log(JSON.stringify({file,results:data.results.map(x=>({code:x?.code,error:x?.error,timeout:x?.timeout,opened:x?.opened,closed:x?.closed,fields:Object.keys(x||{})})),protocolEvents:data.protocols.length}));return;}}
 throw Error('Device probe timed out; inspect current game state and logs');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
