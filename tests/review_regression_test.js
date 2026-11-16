'use strict';
const { PROJECT_ROOT } = require("../src/paths");

// Independent review regressions exercise data preservation and the actual
// client callback contract, rather than merely checking code===0.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {FrogDatabase}=require('../src/core/database'),{ActivitiesService}=require('../src/game/activities/activities'),{CardsService}=require('../src/game/activities/cards'),{CreativeService}=require('../src/game/creative/creative'),{ExplorationService}=require('../src/game/activities/exploration'),{SnapshotService}=require('../src/core/snapshots');

test('failed compass/inspire replies leave the native client path and inspire counters intact',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('review');
 const service=new ExplorationService(db,{items:[],config:{}},{now:()=>1000,randomInt:()=>0,dailyCompasses:0});
 const events=[],state=service.exploreState('review','museumday',1000,events);
 Object.assign(state,{cur_museum:1,path:[{grid:1,type:0,style:0},{grid:2,type:1,style:1}],frog:1,next:1,compass:0,inspire_num:0});service.save('review','museumday',state);
 for(const cmd of ['museumday_random_compass','museumday_inspire']){
  const response=service.handle('review',cmd,{}).response;assert.equal(response.code,1);
  const client={next:1,inspire_num:0};
  // MuseumDayModel's native callbacks do not inspect response.code.
  if(response.next!==client.next){if(cmd.endsWith('inspire'))client.inspire_num--;else client.inspire_num=response.inspire;client.next=response.next;}
  assert.deepEqual(client,{next:1,inspire_num:0},'failure must echo current next to avoid corrupting native client state');
 }
});

test('all new modules preserve actual captured possessions and repeated initialization cannot award them again',t=>{
 const root=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets'),filename=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/converted-save.json');
 if(!fs.existsSync(filename)||!fs.existsSync(path.join(root,'eab/config.eab'))){t.skip('personal capture and client assets are optional');return;}
 const {loadCatalog,readBundle}=require('../src/core/catalog'),config=readBundle(path.join(root,'eab/config.eab')),catalog={...loadCatalog(root),config};
 const original=JSON.parse(fs.readFileSync(filename,'utf8')),account=original.account.account,db=new FrogDatabase(':memory:');t.after(()=>db.close());db.importAccount(original,true);
 const now=2000000000,creative=new CreativeService(db,catalog,{clock:()=>now,random:()=>0}),activities=new ActivitiesService(db,catalog,{now:()=>now,randomInt:()=>0}),cards=new CardsService(db,catalog,{now:()=>now,randomInt:()=>0}),exploration=new ExplorationService(db,catalog,{now:()=>now,randomInt:()=>0});
 const modules=[creative,activities,cards,exploration];for(const module of modules)module.initial(account);
 const current=creative.state(account),raw=original.official.protocols;
 assert.deepEqual(current.drawing.pages,raw.guest_load_drawing.pages);assert.deepEqual(current.drawing.colls,raw.guest_load_drawing.colls);assert.deepEqual(current.drawing.bag,raw.guest_load_drawing.bag);
 assert.deepEqual(current.pocket.list,raw.furniture_load_pocket.list);assert.deepEqual(current.flowerpot.list,raw.furniture_load_flowerpot.list);assert.deepEqual(current.tumbler.tumbler_list,raw.furniture_load_tumbler.tumbler_list);
 assert.deepEqual(activities.animState(account,now).pic_list.map(({next_at,...row})=>row),raw.animpicture_load.pic_list.map(row=>({...row,pictures:Array.isArray(row.pictures)?row.pictures:[],exp_pic:Array.isArray(row.exp_pic)?row.exp_pic:[]})));
 const cake=cards.cakeState(account,now);for(const field of ['cream','sugar','pre_cream','pre_sugar'])assert.equal(cake[field],raw.partycake_load[field]);
 const first=db.exportAccount(account);for(const module of modules)module.initial(account);const second=db.exportAccount(account);
 delete first.exported_at;delete second.exported_at;assert.deepEqual(second,first,'same-day reconnect must not duplicate daily coins, stickers, materials or rewards');
 assert.deepEqual(db.getOfficialArchive(account),original.official,'all original capture bytes remain authoritative in preservation archive');
});

test('snapshot restores a held dynamic source and queued photo after later permanent deletion without minting duplicates',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('review');
 const config={animpictureData_json:{base_info:{page_id:9001,album_id:9002,album_num:4},list:{1:{id:1,pic_list:[100],phase_list:[{exp:20},{exp:0}]}},pic_map:{100:1}}};
 const catalog={items:[{id:9001,type:9},{id:9002,type:9}],config};const service=new ActivitiesService(db,catalog,{now:()=>1000,randomInt:()=>0}),picture=id=>({id,pic_id:100,layers:[{layer:[1,0.5,-0.5]}]});
 db.changeInventory('review',9001,1);db.addPostcard('review',picture(101),'album');db.addPostcard('review',picture(102),'album');
 assert.equal(service.handle('review','animpicture_select_pic',{id:101}).response.code,0);assert.equal(service.handle('review','animpicture_add_pic',{anim_index:1,ids:[102]}).response.code,0);
 const snapshots=new SnapshotService(db),checkpoint=snapshots.create('review','dynamic-review');
 assert.equal(service.handle('review','animpicture_remove_pic',{anim_index:1,pic_index:1,is_delete:true}).response.code,0);assert.equal(db.getPostcards('review','album',[102]).length,0);
 snapshots.restore('review',checkpoint.id,'review');
 const held=service.animState('review',1000).pic_list[0];assert.equal(held.source_picture.id,101);assert.equal(held.exp_pic[0].id,102);assert.deepEqual(held.exp_pic[0].layers,picture(102).layers);
 assert.equal(service.handle('review','animpicture_remove_pic',{anim_index:1,pic_index:1,is_delete:false}).response.code,0);assert.equal(service.handle('review','animpicture_remove_pic',{anim_index:1,pic_index:1,is_delete:false}).response.code,1);assert.equal(db.getPostcards('review','album',[102]).length,1);
});
