'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {FrogDatabase}=require('../core/database');
const array=value=>Array.isArray(value)?value:[];
function convertCapture(capture){
  if(capture.format!=='frog-official-protocol-capture'||!capture.complete)throw Error('Capture incomplete');
  const responses=capture.responses, latest={};
  for(const [cmd,entries]of Object.entries(responses))if(entries.length)latest[cmd]=entries.at(-1).data;
  for(const cmd of ['client_load_role','album_load_all','album_load_recover','travel_load_gift','item_load_items','travel_load_note','furniture_load_furniture'])if(!Object.hasOwn(latest,cmd))throw Error('Missing '+cmd);
  const role=latest.client_load_role,frog=role.frog,account='official-'+role.uid;
  const detail=new Map();
  for(const response of responses.album_load_by_id_list||[])for(const p of array(response.data.pic_list))detail.set(p.id,p);
  const album=array(latest.album_load_all.id_list).map(p=>({...p,...detail.get(p.id),location:'album'}));
  const postcards=[...album,...array(latest.album_load_new?.pictures).map(p=>({...p,location:'new'})),...array(latest.album_load_recover.pictures).map(p=>({...p,location:'recycle'})),...array(latest.travel_load_gift.pictures).map(p=>({...p,location:'gift'}))];
  const missing=postcards.filter(p=>!Array.isArray(p.layers)||!p.layers.length);
  if(missing.length||album.length!==role.misc.picture_cnt)throw Error('Postcard completeness mismatch');
  if(new Set(postcards.map(p=>p.id)).size!==postcards.length)throw Error('Duplicate postcard IDs across locations');
  const unknownPictureIds=postcards.filter(p=>p.pic_id===undefined).map(p=>p.id);
  // Gift-box protocol omits pic_id. 0 is a documented unknown sentinel;
  // the exact original layers are preserved and render independently of pic_id.
  postcards.forEach(p=>{p.pic_id??=0;p.visit=Boolean(p.visit);p.for_ads=Boolean(p.for_ads);});
  const fur=latest.furniture_load_furniture;
  if(fur.bench_lock)throw Error('Official in-progress craft requires manual mapping; raw capture retained');
  const time=Math.floor((capture.finished_at||Date.now())/1000);
  const settings=JSON.parse(role.settings.client);
  const snapshot={format:'travel-frog-save',version:6,exported_at:time,
    account:{account,uid:String(role.uid),frog_name:frog.name,icon:frog.icon,current_achievement:frog.cur_achieve,current_picture_id:null,
      clover:role.res.clover_point,ticket:role.res.ticket,push_switch:role.settings.push_switch,rank_switch:role.settings.rank_switch,settings,
      created_at:role.misc.create_time,frog_status:frog.status,frog_motion:frog.motion,trip_count:latest.annual_load?.travel_num||0},
    postcards,moments:array(latest.misc_moment_load?.list),travel_notes:array(latest.travel_load_note.note_list),stories:array(latest.story_load?.stories),
    achievements:array(frog.achieves).map(id=>({id,time:array(frog.achieves_time).find(x=>x.id===id)?.time||0})),
    handbook:{collections:array(latest.item_load_handbook?.collections),specialtys:array(latest.item_load_handbook?.specialtys)},
    encyclopedia:{unlock_list:array(latest.encyclopedia_load?.unlock_list),unlock_desc:array(latest.encyclopedia_load?.unlock_desc).map(x=>({...x,list:array(x.list)})),show_sub:array(latest.encyclopedia_load?.show_sub)},
    gift_specialties:array(latest.travel_load_gift.specialtys),items:latest.item_load_items,shop_purchases:array(latest.item_load_shop_info?.purchased),
    clover_plots:array(latest.clover_load_clovers),mails:array(latest.mail_load),weather:latest.weather_load,travel:{current:null,events:array(latest.client_load_events)},
    visitor:{current:latest.visit_load?.visitor||null,acquire:array(latest.visit_load?.acquire),next_visit_at:0,visit_count:0},
    furniture:{bench:fur.bench,owned:array(fur.has_fur),placed:array(fur.put_fur),job:null,shop_start:Math.max(1,fur.shop.start_time||time),shop_end:Math.max((fur.shop.start_time||time)+1,fur.shop.leave_time||time+86400),purchases:{},shop_bought:{}},
    official:{mode:'preserved',source_account:capture.account,captured_at:capture.finished_at,capture,protocols:latest,limitations:{unknown_gift_pic_ids:unknownPictureIds,server_internals_unavailable:true}},
  };
  return snapshot;
}
function verifyImport(snapshot,db){
  const out=db.exportAccount(snapshot.account.account),report={account:out.account.account,frog_name:out.account.frog_name,checks:{}};
  for(const field of ['postcards','travel_notes','stories','moments','shop_purchases','gift_specialties','achievements']){
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
    const sorted=a=>a.map(canonical).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
    report.checks[field]=JSON.stringify(sorted(snapshot[field]))===JSON.stringify(sorted(out[field]));
  }
  for(const field of ['clover','ticket','frog_status','frog_motion','uid','frog_name'])report.checks[field]=snapshot.account[field]===out.account[field];
  report.checks.inventory=JSON.stringify([...snapshot.items.house].sort((a,b)=>a.item_id-b.item_id))===JSON.stringify(out.items.house);
  report.checks.bag=JSON.stringify(snapshot.items.bag)===JSON.stringify(out.items.bag);
  report.checks.desk=JSON.stringify(snapshot.items.desk)===JSON.stringify(out.items.desk);
  report.checks.original_capture=JSON.stringify(snapshot.official.capture)===JSON.stringify(out.official.capture);
  report.checks.raw_protocols=JSON.stringify(snapshot.official.protocols)===JSON.stringify(out.official.protocols);
  report.checks.furniture=JSON.stringify(snapshot.furniture)===JSON.stringify(out.furniture);
  report.checks.no_seed_mail=out.mails.length===snapshot.mails.length;
  report.counts={album:out.postcards.filter(x=>x.location==='album').length,gift:out.postcards.filter(x=>x.location==='gift').length,recycle:out.postcards.filter(x=>x.location==='recycle').length,inventory:out.items.house.length,notes:out.travel_notes.length,stories:out.stories.length,achievements:out.achievements.length,furniture:out.furniture.owned.length,protocols:Object.keys(out.official.protocols).length};
  if(Object.values(report.checks).some(x=>!x))throw Error('Import verification failed: '+JSON.stringify(report));
  return report;
}
async function main(){
  const [filename,dbFile]=process.argv.slice(2);if(!filename)throw Error('usage: node official_import.js capture.json [target.sqlite]');
  const bytes=fs.readFileSync(filename),capture=JSON.parse(bytes),snapshot=convertCapture(capture);
  const root=path.dirname(path.resolve(filename));
  fs.writeFileSync(path.join(root,'converted-save.json'),JSON.stringify(snapshot,null,2));
  const db=new FrogDatabase(dbFile||':memory:');
  try{
    if(db.getAccounts().some(x=>x.account===snapshot.account.account))throw Error('Target official account already exists; refusing overwrite');
    db.importAccount(snapshot,true);
    const report=verifyImport(snapshot,db);report.capture_sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(root,'import-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={convertCapture,verifyImport};
