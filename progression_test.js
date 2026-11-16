'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{FrogDatabase}=require('./database'),{ProgressionService}=require('./progression');
const {ModuleState}=require('./module_state');
test('configuration conditions unlock once and progression survives import with private account isolation',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');db.ensureAccount('b');let now=1794821527;
 const catalog={items:[{id:15,name:'果汁'},{id:3000,name:'双皮奶'}],specialties:[],config:{Achieve_json:[{id:0,info:'（默认）'},{id:1,info:'旅行达到10次'},{id:11,info:'连续4次带“果汁”出发'},{id:24,info:'双皮奶超过10个'},{id:7,info:'出发不到30分钟就回家'},{id:21,info:'登录达到60天'}],encytravel_json:{list:{100:{id:10,long_id:100,item_id:15}},desc:{10:{1:'info'}}}}};
 const p=new ProgressionService(db,catalog,{clock:()=>now});p.record('a','login');db.updateAccount('a',{trip_count:10});db.changeInventory('a',3000,10);assert.deepEqual(p.sync('a').earned,[1]);db.changeInventory('a',3000,1);assert.deepEqual(p.sync('a').earned,[24]);
 for(let i=0;i<4;i++)p.record('a','trip-start',{food:15});assert.ok(db.getRole('a').frog.achieves.includes(11));
 p.record('a','trip-return',{duration:100,place:'city'});assert.ok(db.getRole('a').frog.achieves.includes(7));
 db.changeInventory('a',15,1);p.sync('a');assert.deepEqual(p.travelBook('a').unlock_list,[100]);
 assert.equal(p.handle('a','encytravel_set_show_sub',{long_id:999}).response.code,1);assert.equal(p.handle('a','encytravel_set_show_sub',{long_id:100}).response.code,0);
 const exported=db.exportAccount('a');db.importAccount(exported);assert.deepEqual(p.sync('a').earned,[]);assert.deepEqual(p.travelBook('b').unlock_list,[]);
 for(let i=0;i<60;i++){now+=86400;p.record('a','login');}assert.ok(db.getRole('a').frog.achieves.includes(21));
});

test('museum titles count individual museum collections, not museum visits or overlapping item IDs',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');
 const config={Achieve_json:[{id:82,info:'获得4个典藏（博物馆）'}],Collection_json:[{id:0,type:1},...[34,35,36,37].map(id=>({id,type:3}))]};
 const p=new ProgressionService(db,{items:[{id:34,type:0}],config});db.changeInventory('a',34,99);p.record('a','museum-acquire',{id:1});p.record('a','museum-acquire',{id:2});p.record('a','museum-acquire',{id:3});p.record('a','museum-acquire',{id:4});
 assert.ok(!db.getRole('a').frog.achieves.includes(82));for(const id of [34,35,36,37])p.record('a','collection-acquire',{id});assert.ok(db.getRole('a').frog.achieves.includes(82));assert.deepEqual(p.sync('a').earned,[]);
});

test('juice streak uses client travel encyclopedia variants and duplicate trip events cannot increase it',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');const p=new ProgressionService(db,{items:[{id:11,name:'菠萝汁'},{id:12,name:'草莓汁'},{id:0,name:'华夫饼'}],config:{Achieve_json:[{id:11,info:'连续4次带“果汁”出发'}],encytravel_json:{list:{1:{id:1902,item_id:11,name:'果汁',long_id:1},2:{id:1902,item_id:12,name:'果汁',long_id:2}}}}});
 for(let i=0;i<3;i++)p.record('a','trip-start',{food:11,event_id:'same'});assert.ok(!db.getRole('a').frog.achieves.includes(11));
 p.record('a','trip-start',{food:12,event_id:'second'});p.record('a','trip-start',{food:0,event_id:'not-juice'});assert.equal(p.state('a').juice_streak,0);
 for(let i=0;i<4;i++)p.record('a','trip-start',{food:11,event_id:'new-'+i});assert.ok(db.getRole('a').frog.achieves.includes(11));
});

test('timed title items are consumed once, extend duration and expire while unrelated original titles stay intact',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');let now=100000;
 const p=new ProgressionService(db,{items:[{id:203001,type:14,sub_type:8,name:'蛙选之人·1天'},{id:203002,type:14,sub_type:8,name:'蛙选之人·7天'}],config:{Achieve_json:[{id:0,info:'（默认）'},{id:900,name:'蛙选之人',info:'通过道具解锁',is_special:1},{id:901,name:'明星小蛙',info:'通过道具解锁',is_special:1}]}},{clock:()=>now});
 db.db.prepare('INSERT INTO achievements VALUES (?,?,?)').run('a',901,123);db.changeInventory('a',203001,1);const first=p.sync('a');assert.ok(first.earned.includes(900));assert.deepEqual(first.itemChanges,[{item_id:203001,count:0}]);assert.equal(p.state('a').special_titles[900],now+86400);p.sync('a');assert.equal(p.state('a').special_titles[900],now+86400);
 db.changeInventory('a',203002,1);p.sync('a');assert.equal(p.state('a').special_titles[900],now+8*86400);db.updateAccount('a',{current_achievement:900});now+=8*86400;const expired=p.sync('a');assert.deepEqual(expired.expired,[900]);assert.equal(db.getRole('a').frog.cur_achieve,0);assert.ok(db.getRole('a').frog.achieves.includes(901),'unmapped imported special title retained');
});

test('creative growth and decoration stages naturally unlock botanical pages and retain original descriptions',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');db.ensureAccount('b');
 const cfg={Achieve_json:[{id:73,info:'腊梅开放阶段1，花苞期'},{id:74,info:'腊梅开放阶段2，开花期'}],flowerpotData_json:{plant:{2010101:{id:2010101,name:'角堇·火龙果'}}},decoration_json:{100:{id:100,name:'蜡梅'}},encyclopedia_json:{list:{1010101:{id:101,long_id:1010101,name:'角堇',sub_name:'火龙果',pic_id:1,icon:'plant-icon'},1010102:{id:101,long_id:1010102,name:'角堇',sub_name:'火龙果',pic_id:2,icon:'plant-icon'},1010103:{id:101,long_id:1010103,name:'角堇',sub_name:'火龙果',pic_id:3,icon:'plant-icon'},3010102:{id:301,long_id:3010102,name:'蜡梅',sub_name:'素心蜡梅',pic_id:2}},desc:{101:{1:'botany',2:'growth',3:'origin'},301:{1:'botany'}}}};
 const p=new ProgressionService(db,{items:[{id:202211,type:14,name:'角堇·火龙果',img:{index:'plant-icon'}}],config:cfg});const store=new ModuleState(db);db.changeInventory('a',202211,1);p.sync('a');assert.deepEqual(p.encyclopedia('a').unlock_list,[1010101]);
 store.set('a','creative',{flowerpot:{plant_list:[{id:2010101,stage:2}]}});p.sync('a');assert.ok(p.encyclopedia('a').unlock_list.includes(1010103));assert.equal(p.encyclopedia('b').unlock_list.length,0);
 store.set('a','misc',{decoration:{put_id:100,status:1,has_list:[]}});p.sync('a');assert.ok(db.getRole('a').frog.achieves.includes(73));assert.ok(!db.getRole('a').frog.achieves.includes(74));store.set('a','misc',{decoration:{put_id:100,status:2,has_list:[]}});p.sync('a');assert.ok(db.getRole('a').frog.achieves.includes(74));
 assert.equal(p.handle('a','encyclopedia_set_show_sub',{long_id:1010103}).response.code,0);assert.equal(p.handle('b','encyclopedia_set_show_sub',{long_id:1010103}).response.code,1);
 db.db.prepare('INSERT INTO official_archives VALUES (?,?)').run('a',JSON.stringify({mode:'active',protocols:{encyclopedia_load:{unlock_list:[1010101],unlock_desc:[{id:101,list:[99]}],show_sub:[]},encytravel_load:{unlock_list:[777],unlock_desc:[{id:17,list:[1]}],show_sub:[]}}}));assert.ok(p.encyclopedia('a').unlock_desc.find(x=>x.id===101).list.includes(99));assert.ok(p.travelBook('a').unlock_list.includes(777));
});

test('all-city title follows GoalNumber and PictureTag resources including photos in dynamic storage',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');const p=new ProgressionService(db,{items:[],pictures:[{id:2000,name:'beijing1'},{id:2001,name:'chengdu1'}],config:{Achieve_json:[{id:81,info:'旅行地图中全国所有城市都有照片'}],GoalNumber_json:[{id:1,name:'北京',tag:'g_beijing'},{id:2,name:'成都',tag:'g_chengdu'}],PictureTag_json:[{Tag:'g_beijing',picNames:['beijing1']},{Tag:'g_chengdu',picNames:['chengdu1']}]}});
 db.addPostcard('a',{id:1,pic_id:2000,layers:[{layer:[1,0,0]}]},'album');p.sync('a');assert.ok(!db.getRole('a').frog.achieves.includes(81));new ModuleState(db).set('a','animpicture',{pic_list:[{source_picture:{id:2,pic_id:2001,layers:[{layer:[1,0,0]}]}}]});assert.ok(p.sync('a').earned.includes(81));
});

test('specialty discovery and travel encyclopedia are monotonic after spending or moving the item',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');const p=new ProgressionService(db,{items:[{id:3000,type:3,name:'特产'}],specialties:[{itemId:3000}],config:{Achieve_json:[{id:6,info:'获得所有特产食材'}],encytravel_json:{list:{100:{id:10,long_id:100,item_id:3000}},desc:{10:{1:'origin',2:'effect'}}}}});
 db.changeInventory('a',3000,1);assert.ok(p.sync('a').earned.includes(6));db.changeInventory('a',3000,-1);p.sync('a');assert.deepEqual(db.getHandbook('a').specialtys,[3000]);assert.deepEqual(p.travelBook('a').unlock_list,[100]);assert.equal(p.travelBook('a').unlock_desc[0].list.length,2);
});

test('independent decoration module and its real stage history unlock flower titles after replacing or expiring a stem',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');const store=new ModuleState(db),p=new ProgressionService(db,{items:[],config:{Achieve_json:[{id:73,info:'腊梅开放阶段1，花苞期'},{id:74,info:'腊梅开放阶段2，开花期'},{id:79,info:'木槿开放阶段1，花苞期'},{id:80,info:'木槿开放阶段2，开花期'}],decoration_json:{100:{id:100,name:'蜡梅'},101:{id:101,name:'木槿'}}}});
 store.set('a','decoration',{has_list:[],put_id:100,status:1,stage_history:[{id:100,stage:1,at:1000}]});assert.deepEqual(p.sync('a').earned,[73]);
 store.set('a','decoration',{has_list:[],put_id:0,status:0,stage_history:[{id:100,stage:1,at:1000},{id:100,stage:2,at:2000},{id:101,stage:1,at:3000},{id:101,stage:2,at:4000}]});assert.deepEqual(p.sync('a').earned,[74,79,80]);assert.deepEqual(p.sync('a').earned,[]);
});

test('latest supplied catalog maps all 103 title conditions and can naturally satisfy every rule in an isolated fixture',t=>{
 const fs=require('node:fs'),path=require('node:path'),{loadCatalog,readBundle}=require('./catalog');const root=path.join(__dirname,'exports/oneplus-official-20261114-live/assets');if(!fs.existsSync(root+'/eab/config.eab')){t.skip('Local user-supplied APK config is optional');return;}
 const catalog={...loadCatalog(root),config:readBundle(root+'/eab/config.eab')},db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');let now=Date.UTC(2028,5,1)/1000;
 const p=new ProgressionService(db,catalog,{clock:()=>now}),coverage=p.coverage();assert.equal(coverage.length,103);assert.equal(coverage.filter(x=>x.kind==='unknown'||(x.kind==='inventory'&&x.item===undefined)).length,0);assert.equal(p.cityGroups.length,35);
 // Fixture acquisition uses the same public item/collection event paths as rewards.
 for(const rule of coverage.filter(x=>x.kind==='inventory'))db.changeInventory('a',rule.item,rule.count+1);
 for(const item of catalog.specialties)if(db.getInventoryCount('a',item.itemId)===0)db.changeInventory('a',item.itemId,1);
 for(const collection of Object.values(catalog.config.Collection_json))p.record('a','collection-acquire',{id:collection.id});
 db.updateAccount('a',{clover:100001,trip_count:100});require('./gameplay').importGachaState(db,'a',{color_ball:-1,reward_credits:0,draw_count:20});
 for(const city of p.cityGroups)db.addPostcard('a',{id:db.nextPostcardId('a'),pic_id:[...city.ids][0],layers:[{layer:[1,0,0]}]},'album');
 p.record('a','login');for(const plant of ['腊梅','木槿'])p.record('a','flower-stage',{plant,stage:2});
 p.record('a','trip-return',{duration:100});p.record('a','trip-return',{duration:86401});p.record('a','anniversary-login');
 const juice=Object.values(catalog.config.encytravel_json.list).find(x=>x.name==='果汁').item_id;for(let i=0;i<4;i++)p.record('a','trip-start',{food:juice,event_id:i});
 const state=p.state('a');state.days=Array.from({length:360},(_,i)=>new Date((now-i*86400+28800)*1000).toISOString().slice(0,10));new ModuleState(db).set('a','progression',state);
 for(const id of [203001,203011,203021])db.changeInventory('a',id,1);p.sync('a');
 assert.deepEqual(db.getRole('a').frog.achieves.sort((a,b)=>a-b),coverage.map(x=>x.id).sort((a,b)=>a-b));
});
