'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FrogDatabase}=require('../src/core/database');
const {convertCapture,verifyImport}=require('../src/archive/official_import');
function fixture(){
 const protocols={
  client_load_role:{uid:123,res:{clover_point:50,ticket:2},settings:{client:'{"guideStep":"Complete"}'},misc:{picture_cnt:1,create_time:100},frog:{name:'原蛙',icon:0,cur_achieve:0,achieves:[0],achieves_time:{},status:3,motion:-1}},
  album_load_all:{id_list:[{id:5,pic_id:100}]},album_load_by_id_list:{pic_list:[{id:5,pic_id:100,layers:[{layer:[1,-0.5,2.5]}]}]},album_load_recover:{pictures:{}},album_load_new:{pictures:{}},travel_load_gift:{pictures:[{id:8,layers:[{layer:[2,0.5,0]}]}],specialtys:{}},
  item_load_items:{house:[{item_id:0,count:4}],bag:[0,-1,-1,-1],desk:Array(8).fill(-1),gacha:{color_ball:-1}},travel_load_note:{note_list:[{id:1000,read:true,timestamp:101}]},
  furniture_load_furniture:{bench:Array(10).fill(-1),bench_lock:false,has_fur:[1001],put_fur:[{id:1001,type:1}],shop:{start_time:100,leave_time:200}},
  clover_load_clovers:[{clover_id:1,element:0,sprite:1,last_harvest:100,rebirth_span:7200}],weather_load:{season:1,hours_type:1,weather:1},mail_load:{},
  furniture_load_flowerpot:{list:[401],plant_list:[{id:7,state:3}],show_index:1},guest_load_drawing:{state:4,guest:0,pages:[11]},
 };
 return {format:'frog-official-protocol-capture',complete:true,finished_at:200000,account:'source-user',responses:Object.fromEntries(Object.entries(protocols).map(([cmd,data])=>[cmd,[{data,time:150000}]]))};
}
test('official capture preserves fractional layers, unknown gift metadata and unsupported modules',()=>{
 const capture=fixture(),save=convertCapture(capture),db=new FrogDatabase(':memory:');
 try{db.importAccount(save);const report=verifyImport(save,db);assert.ok(Object.values(report.checks).every(Boolean));assert.equal(db.getPostcards(save.account.account,'album')[0].layers[0].layer[1],-.5);assert.equal(db.getPostcards(save.account.account,'gift')[0].pic_id,0);assert.equal(db.getMails(save.account.account).length,0);assert.deepEqual(db.getOfficialArchive(save.account.account).protocols.furniture_load_flowerpot,capture.responses.furniture_load_flowerpot[0].data);}finally{db.close();}
});
test('official import refuses incomplete album and pending unmappable craft',()=>{
 const x=fixture();x.responses.album_load_by_id_list=[];assert.throws(()=>convertCapture(x),/completeness/);
 const y=fixture();y.complete=false;assert.throws(()=>convertCapture(y),/incomplete/);
 const z=fixture();z.responses.furniture_load_furniture[0].data.bench_lock=true;assert.throws(()=>convertCapture(z),/manual mapping/);
});
test('reopening official archives never seeds a sample reward or resets raw state',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frog-official-test-')),filename=path.join(dir,'state.sqlite'),save=convertCapture(fixture());
 let db=new FrogDatabase(filename);
 try{db.importAccount(save);db.close();db=new FrogDatabase(filename);verifyImport(save,db);assert.equal(db.getMails(save.account.account).length,0);}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
