'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {FrogDatabase}=require('../src/core/database');
test('committed travel plan returns reusable equipment, consumes actual expendables and restores four slots with optional rewards',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');db.updateAccount('a',{bag_json:'[0,1001,2003,1002]',bag_completed:1});
 const route={id:12000,picId:2000,destination:'测试目的地',specialtyId:3000,noteId:1000};const started=db.startTravel('a',route,-1,10,100);
 db.modules.set('a','travel-plan',{trip_number:started.trip.trip_number,spending:{consumed:[{slot:1,item_id:0,count:1},{slot:4,item_id:1002,count:1}],returned:[{slot:2,item_id:1001,count:1},{slot:3,item_id:2003,count:1}],nextBag:[-1,-1,-1,-1]},rewards:{specialty:{item_id:3000,count:2},noteId:null,collectionId:7},homeWaitSeconds:50});
 const before=db.exportAccount('a');db.importAccount(before);
 let captured;const result=db.advanceTravel('a',[route],(r,c,id,context)=>{captured=context;return {id,pic_id:r.picId,layers:[{layer:[1,0.5,1.5]}]};},111);
 assert.equal(result.postcard.pic_id,2000);assert.deepEqual(captured.bag,[0,1001,2003,1002]);assert.equal(db.getInventoryCount('a',1001),1);assert.equal(db.getInventoryCount('a',2003),1);assert.equal(db.getInventoryCount('a',1002),0);assert.equal(db.getInventoryCount('a',3000),2);
 assert.deepEqual(db.getItemState('a').bag,[-1,-1,-1,-1]);assert.deepEqual(db.getTravelNotes('a'),[]);assert.deepEqual(db.getHandbook('a').collections,[7]);assert.equal(db.modules.get('a','travel-plan').home_at,161);assert.equal(db.advanceTravel('a',[route],()=>assert.fail('duplicate return'),112),null);
});
test('reusable equipment transferred from the desk goes back to its vacant desk slot, with occupied-slot fallback to inventory',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');db.updateAccount('a',{bag_json:'[0,1001,2003,-1]',desk_json:'[-1,-1,-1,-1,2004,-1,-1,-1]',bag_completed:1});
 const route={id:12000,picId:2000,destination:'测试',specialtyId:3000,noteId:1000};const trip=db.startTravel('a',route,-1,1,100).trip;
 db.modules.set('a','travel-plan',{trip_number:trip.trip_number,spending:{consumed:[{slot:1,item_id:0,count:1}],returned:[{slot:2,item_id:1001,count:1},{slot:3,item_id:2003,count:1}],nextBag:[-1,-1,-1,-1]},desk_loans:[{bag:2,desk:3,item_id:1001},{bag:3,desk:5,item_id:2003}],rewards:{specialty:null,noteId:null,collectionId:null},homeWaitSeconds:60});
 db.advanceTravel('a',[route],(r,c,id)=>({id,pic_id:2000,layers:[{layer:[1,0,0]}]}),102);
 assert.equal(db.getItemState('a').desk[2],1001);assert.equal(db.getInventoryCount('a',1001),0);assert.equal(db.getItemState('a').desk[4],2004);assert.equal(db.getInventoryCount('a',2003),1);assert.deepEqual(db.getHandbook('a').specialtys,[]);
});
