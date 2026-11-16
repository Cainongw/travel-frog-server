'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CreativeService}=require('./creative'),{FrogDatabase}=require('./database'),{importFurnitureState}=require('./furniture');
const {ModuleState}=require('./module_state');
const config={
  drawingPageData_json:{1:{id:1,guest:0},101:{id:101,guest:1},201:{id:201,guest:2}},
  drawingCollectData_json:{1:{id:1,guest:0,page:1},101:{id:101,guest:1,page:0},201:{id:201,guest:2,page:0}},
  drawingCommonData_json:{food:{value2:['0,16'],value3:['1,15'],value4:['2,33']}},
  prayData_json:{1:{id:1,state:[1,2,3,4],wood_body:['101','102','102','102,103'],paper:['','','1001','1001,1002']}},
  prayBodyData_json:{102:{id:102},103:{id:103},1001:{id:1001},1002:{id:1002}},
  prayNoteData_json:{1:{id:1}},stampData_json:{1:{id:1,state:[1,2,3]}},
  tumblerData_json:[{id:20011},{id:20012}],tumblerPathData_json:[{id:1001,adorn:0},{id:2001,adorn:1},{id:11001,adorn:0},{id:12001,adorn:1}],
  compostData_json:{21001:{id:21001}},pocketData_json:{22001:{id:22001}},pocketCommonData_json:{base_info:50},flowerpotData_json:{flowerpot:{23001:{id:23001,pos_list:[[0,0],[20,20]]}},plant:{2010101:{id:2010101,name:'Test bloom',pic:['sprout','growing','bloom']}}},
};
const items=[{id:7000,type:7},{id:7001,type:7},{id:8000,type:8},{id:8001,type:8},{id:16,type:0},{id:15,type:0},{id:33,type:0},{id:3000,type:3},{id:10201,type:12},{id:10401,type:13},{id:10501,type:13},{id:10601,type:13},{id:10701,type:13},{id:10001,type:10},{id:10003,type:10},{id:10005,type:10},{id:20101,type:15,sub_type:2},{id:20003,type:15,sub_type:1},{id:202211,name:'Test bloom',type:14,sub_type:6},{id:8501,type:16,sub_type:1},{id:8502,type:16,sub_type:2},{id:8503,type:16,sub_type:3},{id:1300,type:1}];
function setup(t,file=':memory:'){
  const database=new FrogDatabase(file);database.ensureAccount('frog');let now=100;
  const create=db=>new CreativeService(db,{items,config},{clock:()=>now,random:()=>0,drawingSeconds:20,departSeconds:5,inviteSeconds:40,craftSeconds:10,craftCooldown:5,tumblerSeconds:10,pocketSeconds:5,plantSeconds:20,compostSeconds:10,fertilitySeconds:100});
  const service=create(database);t.after(()=>database.close());return {database,service,setTime:v=>now=v,create};
}
function command(service,cmd,data={}){return service.handle('frog',cmd,data);}

test('drawing invitation, reserved gifts, lock/unlock, departure and one-time collection follow native fields',t=>{
  const {database:db,service:s,setTime}=setup(t);db.changeInventory('frog',7001,1);db.changeInventory('frog',16,1);db.changeInventory('frog',3000,1);
  assert.equal(s.initial('frog').find(x=>x.cmd==='guest_load_drawing').data.state,1);
  assert.equal(command(s,'guest_accept_invit',{is_accept:true}).response.code,0);
  s.advance('frog');assert.equal(command(s,'guest_load_drawing').response.state,2,'accepted invitation does not revert');
  assert.equal(command(s,'guest_putin_bag',{pos:1,id:3000}).response.code,1,'only configured food in hand gift slot');
  assert.equal(command(s,'guest_putin_bag',{pos:1,id:16}).response.code,0);assert.equal(db.getInventoryCount('frog',16),0);
  assert.equal(command(s,'guest_putin_bag',{pos:1,id:16}).response.code,0,'repeat placement reserves once');
  assert.equal(command(s,'guest_putin_bag',{pos:2,id:3000}).response.code,0);
  assert.equal(command(s,'guest_lock_bag').response.code,0);assert.equal(command(s,'guest_takeout_bag',{pos:2}).response.code,1);
  assert.equal(command(s,'guest_lock_bag').response.code,0,'native no-argument RPC toggles unlock');
  command(s,'guest_lock_bag');setTime(105);let update=s.advance('frog');assert.equal(db.getRole('frog').frog.status,3);assert.ok(update.events.some(x=>x.cmd==='notify_new_event'&&x.data.event.evt_type===23));
  assert.equal(command(s,'guest_lock_bag').response.code,1,'party in progress cannot toggle preparation');
  setTime(124);s.advance('frog');assert.equal(db.getRole('frog').frog.status,3);
  setTime(125);update=s.advance('frog');const drawing=command(s,'guest_load_drawing').response;assert.equal(drawing.state,0);assert.deepEqual(drawing.bag,[-1,-1,-1,-1]);assert.deepEqual(drawing.pages,[1]);assert.deepEqual(drawing.colls,[1]);
  assert.equal(db.getInventoryCount('frog',3000),0);assert.equal(db.getRole('frog').frog.status,0);
  assert.deepEqual(update.events.find(x=>x.cmd==='notify_new_event').data.event.evt_value,[1,1,20,0]);
  const balance=db.getRole('frog').res.clover_point;s.advance('frog');assert.equal(db.getRole('frog').res.clover_point,balance);assert.equal(db.getTravelEvents('frog').filter(x=>x.evt_type===24).length,1);
  setTime(165);s.advance('frog');assert.equal(command(s,'guest_load_drawing').response.state,1,'next invitation reappears after cooldown');
});

test('rejecting an invitation and repeated take never duplicate reserved gifts',t=>{
  const {database:db,service:s}=setup(t);db.changeInventory('frog',7001,1);db.changeInventory('frog',16,1);s.initial('frog');command(s,'guest_accept_invit',{is_accept:true});command(s,'guest_putin_bag',{pos:1,id:16});command(s,'guest_takeout_bag',{pos:1});command(s,'guest_takeout_bag',{pos:1});assert.equal(db.getInventoryCount('frog',16),1);
  command(s,'guest_putin_bag',{pos:1,id:16});command(s,'guest_accept_invit',{is_accept:false});command(s,'guest_accept_invit',{is_accept:false});assert.equal(db.getInventoryCount('frog',16),1);
});

test('official drawing and tumbler collections are retained without fabricating a missing party deadline',t=>{
  const {database:db,service:s}=setup(t);db.changeInventory('frog',7001,1);
  db.db.prepare('INSERT INTO official_archives(account,data_json) VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:{guest_load_drawing:{state:4,guest:2,pages:[201],colls:[201],bag:[16,3000,-1,-1],pen_motion:'write4'},pray_load_grays:{wishs:{},boxes:{},stamps:{}},furniture_load_tumbler:{show_index:1,tumbler_list:[{id:20011,layers:[{layer:[1001,0,0,0,0]}]}]}}}));
  const list=s.initial('frog');assert.equal(list.find(x=>x.cmd==='guest_load_drawing').data.state,2);assert.deepEqual(list.find(x=>x.cmd==='guest_load_drawing').data.pages,[201]);assert.equal(list.find(x=>x.cmd==='furniture_load_tumbler').data.tumbler_list.length,1);assert.equal(db.getTravelEvents('frog').length,0);
  const pray=list.find(x=>x.cmd==='pray_load_grays').data;assert.deepEqual(pray,{wishs:[],stamps:[],boxes:[],wish_new:null,stamp_new:null});
});

test('handcraft automatic jobs consume once, finish into valid wish/stamp records, and preserve pending dates',t=>{
  const {database:db,service:s,setTime,create}=setup(t);db.changeInventory('frog',7000,1);db.changeInventory('frog',8000,3);
  s.advance('frog');assert.equal(db.getInventoryCount('frog',8000),2);s.advance('frog');assert.equal(db.getInventoryCount('frog',8000),2);
  const reopened=create(db);setTime(110);reopened.advance('frog');let craft=command(reopened,'pray_load_grays').response;assert.equal(craft.wishs.length,1);assert.equal(craft.wishs[0].state,4);assert.equal(craft.wishs[0].paper,1001);assert.equal(craft.wish_new.u_id,craft.wishs[0].u_id);
  setTime(115);reopened.advance('frog');assert.equal(db.getInventoryCount('frog',8000),1);setTime(125);reopened.advance('frog');craft=command(reopened,'pray_load_grays').response;assert.equal(craft.stamps.length,1);assert.equal(craft.stamps[0].state,1);assert.equal(craft.stamp_new.id,1);
  assert.equal(craft.wishs.length,1);reopened.advance('frog');assert.equal(command(reopened,'pray_load_grays').response.stamps.length,1);
});

test('compose requires all three actual fragments and confirmation never awards box items twice',t=>{
  const {database:db,service:s,setTime}=setup(t);
  assert.equal(command(s,'pray_compose',{id:5502}).response.code,1);assert.equal(command(s,'pray_compose',{id:123}).response.code,1);
  for(const id of [8501,8502,8503])db.changeInventory('frog',id,1);
  const result=command(s,'pray_compose',{id:5502});assert.deepEqual(result.response.item_list,[1300]);assert.equal(db.getInventoryCount('frog',1300),1);
  assert.equal(command(s,'pray_compose',{id:5502}).response.code,1);assert.equal(db.getInventoryCount('frog',1300),1);
  db.changeInventory('frog',7000,1);db.changeInventory('frog',8001,1);s.advance('frog');setTime(110);s.advance('frog');assert.equal(command(s,'pray_load_grays').response.boxes.length,1);
  const inventory=db.getItemState('frog').house;command(s,'pray_confirm_make_box');command(s,'pray_confirm_make_box');assert.deepEqual(db.getItemState('frog').house,inventory);assert.deepEqual(command(s,'pray_load_grays').response.boxes,[]);
});

test('tumbler workbench job locks, persists, completes a valid layered object and replaces by one-based index',t=>{
  const {database:db,service:s,setTime,create}=setup(t);for(const id of [10401,10201,10001])db.changeInventory('frog',id,1);
  importFurnitureState(db,'frog',{bench:[10201,...Array(9).fill(-1)],owned:[],placed:[],job:null,shop_start:1,shop_end:1000,purchases:{},shop_bought:{}});
  s.advance('frog');assert.equal(s.isBenchLocked('frog'),true);assert.equal(s.decorateFurnitureState('frog',{bench_lock:false}).bench_lock,true);assert.equal(db.getInventoryCount('frog',10001),0);
  const reopened=create(db);setTime(109);reopened.advance('frog');assert.equal(reopened.isBenchLocked('frog'),true);setTime(110);const result=reopened.advance('frog');assert.equal(reopened.isBenchLocked('frog'),false);
  const data=command(reopened,'furniture_load_tumbler').response;assert.equal(data.tumbler_list.length,1);assert.equal(data.tumbler_list[0].id,20011);assert.ok(data.tumbler_list[0].layers.every(x=>x.layer.length===5));
  assert.deepEqual(result.events.find(x=>x.cmd==='notify_new_event').data.event.evt_value,[5,1001,0,0,0,0,2001,0,0,0,0]);
  assert.equal(command(reopened,'furniture_replace_tumbler',{index:1}).response.code,1);assert.equal(command(reopened,'furniture_load_tumbler').response.show_index,1);assert.equal(command(reopened,'furniture_replace_tumbler',{index:99}).response.code,-1);assert.equal(command(reopened,'furniture_load_tumbler').response.show_index,1);
  reopened.advance('frog');assert.equal(command(reopened,'furniture_load_tumbler').response.tumbler_list.length,1);assert.equal(db.getInventoryCount('frog',10201),1,'tool and guide remain reusable');
});

test('creative state and inventory changes roll back together if persistence fails',t=>{
  const {database:db,service:s}=setup(t);db.changeInventory('frog',7001,1);db.changeInventory('frog',16,1);s.initial('frog');command(s,'guest_accept_invit',{is_accept:true});
  const original=s.storage.set.bind(s.storage);s.storage.set=()=>{throw Error('disk unavailable');};assert.throws(()=>command(s,'guest_putin_bag',{pos:1,id:16}),/disk unavailable/);s.storage.set=original;
  assert.equal(db.getInventoryCount('frog',16),1);assert.equal(command(s,'guest_load_drawing').response.bag[0],-1);
});

test('creative jobs survive physical database reopen and module export/import',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'frog-creative-')),filename=path.join(directory,'game.sqlite');let db=new FrogDatabase(filename),now=100;
  t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});db.ensureAccount('frog');db.changeInventory('frog',7000,1);db.changeInventory('frog',8000,1);
  let service=new CreativeService(db,{items,config},{clock:()=>now,random:()=>0,craftSeconds:10});service.advance('frog');const modules=new ModuleState(db).export('frog');db.close();
  db=new FrogDatabase(filename);service=new CreativeService(db,{items,config},{clock:()=>now,random:()=>0});now=1000;service.advance('frog');assert.equal(service.handle('frog','pray_load_grays').response.wishs.length,1);
  db.ensureAccount('copy');new ModuleState(db).import('copy',modules);service.advance('copy');assert.equal(service.handle('copy','pray_load_grays').response.wishs.length,1,'committed original deadline survives another runtime configuration');
});

test('latest local APK supplies valid creative output definitions',t=>{
  const filename=path.join(__dirname,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(filename)){t.skip('private APK assets optional');return;}
  const actual=require('./catalog').readBundle(filename),db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('frog');
  const s=new CreativeService(db,{items:values(actual.Item_json),config:actual},{clock:()=>100,random:()=>0});
  assert.equal(s.pages.length,21);assert.equal(s.tumblers.length,36);for(const row of s.tumblers)assert.ok(s.tumblerLayers(row.id).every(x=>s.paths.some(p=>p.id===x.layer[0])));
  assert.equal(s.plants.length,35);assert.ok(s.plants.every(plant=>s.plantReward(plant)),'every plant has a real item output, including vegetable family names');
  db.changeInventory('frog',7000,1);db.changeInventory('frog',8000,1);s.advance('frog');assert.equal(s.state('frog').pray.job.kind,'wish');
});

function gardenKit(db,service){const state=service.state('frog');state.pocket.list=[22001];state.pocket.show_index=1;state.compost.compost_list=[21001];state.compost.show_index=1;state.flowerpot.list=[23001];state.flowerpot.show_index=1;service.save('frog',state);return state;}
test('pocket accrues to configured capacity offline, claims once and pauses when removed',t=>{
  const {database:db,service:s,setTime}=setup(t);gardenKit(db,s);setTime(110);s.advance('frog');assert.equal(command(s,'furniture_load_pocket').response.clover,2);
  setTime(1000);s.advance('frog');assert.equal(command(s,'furniture_load_pocket').response.clover,50);const before=db.getRole('frog').res.clover_point;
  assert.equal(command(s,'furniture_pocket_get').response.code,0);assert.equal(db.getRole('frog').res.clover_point,before+50);assert.equal(command(s,'furniture_pocket_get').response.code,1);
  assert.equal(command(s,'furniture_replace_pocket',{index:0}).response.code,1);setTime(5000);s.advance('frog');assert.equal(command(s,'furniture_load_pocket').response.clover,0);
  assert.equal(command(s,'furniture_replace_pocket',{index:9}).response.code,-1);assert.equal(command(s,'furniture_replace_pocket',{index:1}).response.code,1);setTime(5010);s.advance('frog');assert.equal(command(s,'furniture_load_pocket').response.clover,2);
});
test('compost reserves six-slot input, locks processing slot and raises fertility once',t=>{
  const {database:db,service:s,setTime}=setup(t);gardenKit(db,s);db.changeInventory('frog',20003,1);db.changeInventory('frog',3000,1);
  assert.equal(command(s,'furniture_putin_box',{pos:1,id:16}).response.code,1);
  assert.equal(command(s,'furniture_putin_box',{pos:1,id:20003}).response.code,0);assert.equal(db.getInventoryCount('frog',20003),0);
  assert.equal(command(s,'furniture_putin_box',{pos:1,id:20003}).response.code,0);s.advance('frog');assert.equal(command(s,'furniture_load_compost').response.box_index,1);
  assert.equal(command(s,'furniture_takeout_box',{pos:1}).response.code,1);
  assert.equal(command(s,'furniture_putin_box',{pos:2,id:3000}).response.code,0);assert.equal(command(s,'furniture_takeout_box',{pos:2}).response.code,0);assert.equal(command(s,'furniture_takeout_box',{pos:2}).response.code,0);assert.equal(db.getInventoryCount('frog',3000),1);
  setTime(110);s.advance('frog');const compost=command(s,'furniture_load_compost').response;assert.equal(compost.state,4);assert.equal(compost.box_index,0);assert.deepEqual(compost.box_list,Array(6).fill(0));assert.equal(s.compostGrowthFactor('frog'),0.75);
  s.advance('frog');assert.equal(db.getInventoryCount('frog',20003),0);setTime(310);s.advance('frog');assert.equal(command(s,'furniture_load_compost').response.state,2);
});
test('owned seeds grow through native stages and harvest real configured item exactly once',t=>{
  const {database:db,service:s,setTime}=setup(t);gardenKit(db,s);db.changeInventory('frog',20101,2);s.advance('frog');let plant=command(s,'furniture_load_flowerpot').response;
  assert.equal(plant.plant_list.length,2);assert.equal(db.getInventoryCount('frog',20101),0);assert.ok(plant.plant_list.every(x=>x.stage===1));assert.equal(command(s,'furniture_flowerpot_harvest',{index:1}).response.code,1);
  setTime(110);s.advance('frog');assert.equal(command(s,'furniture_load_flowerpot').response.plant_list[0].stage,2);
  setTime(120);s.advance('frog');assert.equal(command(s,'furniture_load_flowerpot').response.plant_list[0].stage,3);
  assert.deepEqual(command(s,'furniture_flowerpot_harvest',{index:1}).response.item_list,[{item_id:202211,num:1}]);assert.equal(db.getInventoryCount('frog',202211),1);
  assert.equal(command(s,'furniture_flowerpot_harvest',{index:1}).response.code,1);assert.equal(db.getInventoryCount('frog',202211),1);assert.equal(command(s,'furniture_load_flowerpot').response.plant_list.length,1);
});
test('fertile compost shortens new plant time and passive progress remains committed on a rejected claim',t=>{
  const {database:db,service:s,setTime}=setup(t);const state=gardenKit(db,s);state.compost.state=3;s.save('frog',state);db.changeInventory('frog',20101,1);
  assert.equal(command(s,'furniture_pocket_get').response.code,1);assert.equal(db.getInventoryCount('frog',20101),0);assert.equal(s.state('frog').flowerpot.plant_list.length,1,'auto planting and consumption commit together even on empty pocket');
  setTime(115);s.advance('frog');assert.equal(command(s,'furniture_load_flowerpot').response.plant_list[0].stage,3);
});
test('special structure jobs share the bench lock and add configured compost, pocket and flowerpot ownership',t=>{
  const {database:db,service:s,setTime}=setup(t);for(const id of [10201,10501,10601,10701,10001,10003,10005])db.changeInventory('frog',id,1);
  importFurnitureState(db,'frog',{bench:[10201,...Array(9).fill(-1)],owned:[],placed:[],job:null,shop_start:1,shop_end:1000,purchases:{},shop_bought:{}});
  s.advance('frog');assert.equal(s.isBenchLocked('frog'),true);assert.equal(s.state('frog').structure_job.kind,'compost');
  setTime(110);s.advance('frog');assert.deepEqual(command(s,'furniture_load_compost').response.compost_list,[21001]);assert.equal(s.isBenchLocked('frog'),false);
  setTime(115);s.advance('frog');assert.equal(s.state('frog').structure_job.kind,'pocket');setTime(125);s.advance('frog');assert.deepEqual(command(s,'furniture_load_pocket').response.list,[22001]);
  setTime(130);s.advance('frog');assert.equal(s.state('frog').structure_job.kind,'flowerpot');setTime(140);s.advance('frog');assert.deepEqual(command(s,'furniture_load_flowerpot').response.list,[23001]);
  assert.equal(command(s,'furniture_replace_compost',{index:1}).response.code,1);assert.equal(command(s,'furniture_replace_flowerpot',{index:1}).response.code,1);assert.equal(command(s,'furniture_replace_flowerpot',{index:5}).response.code,-1);
});
test('furniture policy requires the configured tool family and consumes actual reserved/base resources atomically',t=>{
  const {database:db}=setup(t),{FurnitureService}=require('./furniture'),{buildFurnitureRecipes,beginFurnitureCraft}=require('./furniture_policy');
  const catalog={items:[...items,{id:10101,type:11},{id:10301,type:13},{id:10202,type:12}],furniture:[{id:1101,type:1,style:2,drawing:10301,name:'Stone wall'}],bench:[{id:1101,type:1}]};
  const recipes=buildFurnitureRecipes(catalog,{craftSeconds:30});assert.equal(recipes.length,1);assert.deepEqual(recipes[0].tool,[10202]);assert.deepEqual(recipes[0].material,[{item_id:10101,count:1},{item_id:10003,count:1}]);
  const service=new FurnitureService(db,catalog);for(const id of [10201,10202,10301,10003,10101])db.changeInventory('frog',id,1);
  service.put('frog',1,10201,100);service.put('frog',6,10101,100);assert.equal(beginFurnitureCraft(service,'frog',100,recipes).changed,false,'saw cannot substitute for local brush requirement');
  service.take('frog',1,100);service.put('frog',1,10202,100);const started=beginFurnitureCraft(service,'frog',100,recipes);assert.equal(started.started,1101);assert.equal(db.getInventoryCount('frog',10003),0);assert.equal(service.getState('frog',100).bench[5],-1);assert.equal(service.getState('frog',100).job.finish_at,130);assert.equal(db.getInventoryCount('frog',10202),1);assert.equal(db.getInventoryCount('frog',10301),1);
  assert.equal(beginFurnitureCraft(service,'frog',101,recipes).changed,false);assert.equal(service.advance('frog',130).completed,1101);
});
test('latest furniture policy covers every buildable output in the supplied configuration',t=>{
  const filename=path.join(__dirname,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(filename)){t.skip('private assets optional');return;}
  const c=require('./catalog').readBundle(filename),{buildFurnitureRecipes}=require('./furniture_policy');const catalog={items:values(c.Item_json),furniture:values(c.furnitureData_json),bench:values(c.benchData_json)};
  const recipes=buildFurnitureRecipes(catalog);assert.equal(recipes.length,353);const supported=new Set(recipes.map(x=>x.id));assert.ok(catalog.bench.filter(x=>x.type===1).every(x=>supported.has(x.id)));assert.ok(recipes.every(x=>x.provenance.materials==='local-approximation'));
});
function values(value){return Array.isArray(value)?value:Object.values(value||{});}
