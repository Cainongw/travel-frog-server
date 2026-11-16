'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{FrogDatabase}=require('./database'),{WorldService}=require('./world'),{EconomyPolicy}=require('./economy_policy');
test('world schedules native daytime/night motions and transfers actual desk items once into a four-slot prepared bag',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');const catalog={items:[{id:0,type:0},{id:1001,type:1},{id:2003,type:2}],config:{}};db.economy=new EconomyPolicy({catalog});
 db.updateAccount('a',{bag_json:'[-1,-1,-1,-1]',desk_json:'[0,-1,1001,-1,2003,-1,-1,-1]'});let now=Date.UTC(2026,10,16,15)/1000;
 const world=new WorldService(db,catalog,{clock:()=>now,restSeconds:60});world.advance('a');assert.ok([10,11,12,13].includes(db.getRole('a').frog.motion));assert.deepEqual(db.getItemState('a').bag,[0,1001,2003,-1]);assert.deepEqual(db.getItemState('a').desk,Array(8).fill(-1));assert.equal(db.modules.get('a','travel-plan').depart_at,now+60);
 const snapshot=db.exportAccount('a');world.advance('a');assert.deepEqual(db.getItemState('a'),snapshot.items);assert.equal(db.getInventoryCount('a',0),0);
 now+=12*3600;world.advance('a');assert.ok([0,1,2,4].includes(db.getRole('a').frog.motion));db.modules.set('a','world',{weather_manual:true});db.setWeather('a',{season:1,hours_type:1,weather:0});world.advance('a');assert.equal(db.getWeather('a').season,1);
});
