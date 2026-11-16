'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {EconomyPolicy}=require('./economy_policy');
function fixture(){return new EconomyPolicy({random:()=>0,config:{Item_json:[{id:0,type:0,spend:1},{id:1001,type:1,spend:0,own_num:1},{id:2000,type:2,spend:0,own_num:1},{id:9000,type:9,spend:0,own_num:999}],shopData_json:[{id:0,itemId:0,price:10,limit:0,before_buy:[]},{id:1,itemId:2000,price:100,limit:1,before_buy:[]},{id:22,itemId:9000,price:1000,limit:1,before_buy:[]},{id:23,itemId:9000,price:1250,limit:1,before_buy:['shop','22'],is_hide_before:1,is_sold_out_hide:1}],visitors_json:{provinceList:{A:{ID:1,Province:'北京',OtherGiftID:100001,CountFloor:1,CountUpper:2}},actionList:{0:{FoodID:0}}}}});}
test('bag/desk slot types match native UI and invalid imported overflow is returned for migration rather than discarded',()=>{
 const p=fixture();assert.deepEqual(p.slotTypes('bag'),[0,1,2,2]);assert.deepEqual(p.slotTypes('desk'),[0,0,1,1,2,2,2,2]);assert.equal(p.allowsSlot('bag',1,0),true);assert.equal(p.allowsSlot('bag',1,2000),false);assert.equal(p.allowsSlot('bag',5,2000),false);
 assert.deepEqual(p.normalizedSlots('bag',[0,1001,2000,-1,2000]),{slots:[0,1001,2000,-1],overflow:[{slot:5,item_id:2000,count:1}]});
});
test('dynamic shop applies predecessor and equipped-item ownership before charging and projects special effects',()=>{
 const p=fixture();assert.equal(p.checkPurchase(23,{clover:9999}).ok,false);assert.equal(p.checkPurchase(1,{clover:9999,bag:[-1,-1,2000,-1]}).ok,false);assert.equal(p.checkPurchase(0,{clover:9}).ok,false);
 const purchase=p.checkPurchase(23,{clover:2000,purchases:{22:1}});assert.equal(purchase.ok,true);assert.equal(purchase.clover,750);assert.deepEqual(purchase.effects,{albumPagesDelta:1,albumSlotsDelta:6});
 assert.ok(!p.visibleShop().some(x=>x.id===23));assert.ok(p.visibleShop({purchases:{22:1}}).some(x=>x.id===23));assert.ok(!p.visibleShop({purchases:{22:1,23:1}}).some(x=>x.id===23));
 assert.equal(p.inferAlbumBase(186,1),180);assert.equal(p.albumCapacity(2,{baseline:180}),192);assert.equal(p.albumCapacity(0,{preservedCount:207}),207,'never invalidate preserved pictures with a guessed base');
});
test('province visitor uses configured flower province and repeat-gift bounds',()=>{
 const p=fixture();const v=p.provinceVisitor({now:100,durationSeconds:60,acquired:['北京']});assert.equal(v.city,'北京_北京');assert.equal(v.first,false);assert.equal(v.expire_time,160);assert.deepEqual(v.gift,{item_id:100001,count:1});assert.equal(v.food,0);
 assert.throws(()=>p.provinceVisitor({now:100,preferredProvince:'不存在'}),/configuration/);
});
test('automatic season and native hour enums use Asia/Shanghai and stable weather periods',()=>{
 const p=fixture(),time=iso=>Date.parse(iso)/1000;
 assert.equal(p.weatherAt(time('2026-03-05T00:00:00Z')).season,1);assert.equal(p.weatherAt(time('2026-07-05T00:00:00Z')).season,2);assert.equal(p.weatherAt(time('2026-11-05T00:00:00Z')).season,3);assert.equal(p.weatherAt(time('2026-01-05T00:00:00Z')).season,4);
 assert.equal(p.weatherAt(time('2026-11-05T00:00:00Z')).hours_type,1);assert.equal(p.weatherAt(time('2026-11-05T09:00:00Z')).hours_type,2);assert.equal(p.weatherAt(time('2026-11-05T13:00:00Z')).hours_type,3);assert.equal(p.weatherAt(time('2026-11-05T18:00:00Z')).hours_type,4);
 const a=p.weatherAt(time('2026-11-05T00:00:00Z')),b=p.weatherAt(time('2026-11-05T00:02:00Z'));assert.equal(a.weather,b.weather);assert.throws(()=>p.weatherAt(-1),/timestamp/);
});
test('optional real client provides expanded shops and province catalog',t=>{
 const filename=path.join(__dirname,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(filename)){t.skip('client assets optional');return;}
 const p=new EconomyPolicy({config:require('./catalog').readBundle(filename)});assert.ok(p.shop.size>64);assert.ok(p.provinces.length>30);assert.ok(p.shop.get(22).itemId===9000);assert.equal(p.shop.get(23).requires,22);for(let i=0;i<100;i++){const v=p.provinceVisitor({now:100,acquired:[]});assert.ok(p.provinces.some(x=>v.city.startsWith(x.Province+'_')));assert.ok(v.gift.count>=1&&v.gift.count<=2);}
});
