'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {FrogDatabase}=require('./database');
const {FurnitureService,exportFurnitureState,importFurnitureState,validateFurnitureState}=require('./furniture');

const catalog={
  items:[{id:10201,type:12},{id:10211,type:12},{id:10101,type:11},{id:10001,type:10},{id:10301,type:13},{id:10302,type:13},{id:0,type:0}],
  furniture:[
    {id:1001,type:1,style:1,drawing:10301,name:'原墙',res:['wall']},
    {id:1002,type:2,style:1,drawing:10302,name:'原地面',res:['floor']},
    {id:1101,type:1,style:2,drawing:10301,name:'石作墙',res:['stonewall']},
    {id:1102,type:2,style:2,drawing:10302,name:'石作地面',res:['stonefloor']},
  ],
  bench:[{id:1101,type:1},{id:1102,type:1}],
  furnitureShop:[
    {id:1001,item_id:10211,price:750,limit:1,shop_limit:0,has_item:10201},
    {id:2001,item_id:10001,price:20,limit:0,shop_limit:0,has_item:0},
    {id:3001,item_id:10101,price:200,limit:0,shop_limit:1,has_item:0},
    {id:4001,item_id:10301,price:500,limit:1,shop_limit:0,has_item:0},
  ],
};

function setup(t){
  const database=new FrogDatabase(':memory:');
  const service=new FurnitureService(database,catalog,{craftSeconds:60,shopSeconds:120});
  database.ensureAccount('frog');
  t.after(()=>database.close());
  return {database,service};
}

function kit(database,account='frog'){
  for(const id of [10201,10301,10101,10001])database.changeInventory(account,id,1);
}

test('native workbench has ten slots and separates reusable tools from reserved materials',t=>{
  const {database,service}=setup(t);
  kit(database);
  assert.deepEqual(service.getState('frog',100).bench,Array(10).fill(-1));
  assert.equal(service.put('frog',0,10201,100).ok,false);
  assert.equal(service.put('frog',11,10101,100).ok,false);
  assert.equal(service.put('frog',1,10101,100).ok,false);
  assert.equal(service.put('frog',6,10201,100).ok,false);
  assert.equal(service.put('frog',6,10001,100).ok,false);
  assert.equal(service.put('frog',1,10201,100).ok,true);
  assert.equal(database.getInventoryCount('frog',10201),1,'equipped tools remain owned');
  assert.equal(service.put('frog',2,10201,100).ok,false,'same tool cannot occupy two slots');
  assert.equal(service.put('frog',6,10101,100).ok,true);
  assert.equal(database.getInventoryCount('frog',10101),0);
  assert.equal(service.put('frog',6,10101,100).ok,true,'repeated placement does not reserve twice');
  assert.equal(service.put('frog',7,10101,100).ok,false);
  assert.equal(service.take('frog',6,100).ok,true);
  assert.equal(service.take('frog',6,100).ok,true);
  assert.equal(database.getInventoryCount('frog',10101),1,'repeated take does not duplicate material');
  service.take('frog',1,100);
  assert.equal(database.getInventoryCount('frog',10201),1,'take tool does not create a copy');
});

test('automatic craft requires paper, tool, special material, base resource, and frog at home',t=>{
  const {database,service}=setup(t);
  database.changeInventory('frog',10101,1);
  service.put('frog',6,10101,100);
  assert.equal(service.advance('frog',100).changed,false);
  database.changeInventory('frog',10201,1);service.put('frog',1,10201,100);
  assert.equal(service.advance('frog',100).changed,false);
  database.changeInventory('frog',10301,1);
  assert.equal(service.advance('frog',100).changed,false);
  database.changeInventory('frog',10001,1);
  database.updateAccount('frog',{frog_status:1});
  assert.equal(service.advance('frog',100).changed,false);
  database.updateAccount('frog',{frog_status:0});
  const start=service.advance('frog',100);
  assert.equal(start.started,1101);
  assert.deepEqual(start.itemChanges,[{item_id:10001,count:0}]);
  const state=service.getState('frog',100);
  assert.equal(state.bench_lock,true);assert.equal(state.bench[5],-1);
  assert.deepEqual(state.job,{furniture_id:1101,started_at:100,finish_at:160,
    material:[{item_id:10101,count:1},{item_id:10001,count:1}],tool:[10201]});
  assert.equal(service.put('frog',1,10201,101).ok,false);
  assert.equal(service.take('frog',1,101).ok,false);
  assert.equal(service.advance('frog',159).changed,false);
  assert.equal(database.getInventoryCount('frog',10301),1,'drawing is reusable');
});

test('completion adds ownership once, sends event 21, and placement returns native immediate code 1',t=>{
  const {database,service}=setup(t);kit(database);
  service.put('frog',1,10201,100);service.put('frog',6,10101,100);service.advance('frog',100);
  assert.equal(service.replace('frog',1101,101).code,-1,'unbuilt furniture is not selectable');
  const complete=service.advance('frog',160);
  assert.equal(complete.completed,1101);
  assert.equal(complete.event.evt_type,21);assert.equal(complete.event.evt_id,1101);
  assert.equal(service.getState('frog',160).bench_lock,false);
  assert.equal(service.advance('frog',161).changed,false);
  assert.equal(service.getState('frog',161).has_fur.filter(id=>id===1101).length,1);
  const replace=service.replace('frog',1101,162);
  assert.equal(replace.code,1);assert.equal(replace.event.evt_type,22);
  assert.deepEqual(service.getState('frog',162).put_fur.find(x=>x.type===1),{type:1,id:1101});
  assert.equal(service.getState('frog',162).put_fur.filter(x=>x.type===1).length,1);
  assert.equal(service.replace('frog',1101,163).changed,false);
  assert.equal(database.getTravelEvents('frog').length,2,'replayed completion/placement adds no new events');
});

test('merchant prices, prerequisites, per-visit limits and lifetime limits are enforced',t=>{
  const {database,service}=setup(t);
  database.updateAccount('frog',{clover:2000});
  assert.equal(service.buy('frog',1001,100).ok,false);
  database.changeInventory('frog',10201,1);
  const upgrade=service.buy('frog',1001,100);
  assert.equal(upgrade.clover,1250);assert.deepEqual(upgrade.itemChanges,[{item_id:10211,count:1}]);
  assert.equal(service.buy('frog',1001,101).ok,false);
  assert.equal(service.buy('frog',3001,101).ok,true);
  assert.equal(service.buy('frog',3001,102).ok,false);
  assert.equal(service.buy('frog',3001,221).ok,true,'new merchant visit replenishes visit-limited material');
  assert.equal(service.buy('frog',1001,221).ok,false,'lifetime tool limit remains');
  assert.equal(service.buy('frog',4001,221).ok,true);
  assert.equal(service.buy('frog',4001,222).ok,false);
  database.updateAccount('frog',{clover:19});
  assert.equal(service.buy('frog',2001,222).ok,false);
  assert.equal(database.getRole('frog').res.clover_point,19);
  assert.equal(service.buy('frog',999999,222).ok,false);
});

test('pending craft survives restart, snapshot import and offline settlement',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'frog-furniture-')),filename=path.join(directory,'test.sqlite');
  let database=new FrogDatabase(filename),service=new FurnitureService(database,catalog,{craftSeconds:60});
  t.after(()=>{database.close();fs.rmSync(directory,{recursive:true,force:true});});
  database.ensureAccount('frog');kit(database);service.put('frog',1,10201,100);service.put('frog',6,10101,100);service.advance('frog',100);
  const snapshot=exportFurnitureState(database,'frog');
  assert.ok(snapshot.job);database.close();
  database=new FrogDatabase(filename);service=new FurnitureService(database,catalog,{craftSeconds:999});
  assert.equal(service.getState('frog',159).job.finish_at,160,'restart config does not change committed deadline');
  assert.equal(service.advance('frog',1000).completed,1101);
  assert.equal(database.getInventoryCount('frog',10001),0);
  database.ensureAccount('copy');importFurnitureState(database,'copy',snapshot,catalog);
  assert.equal(service.advance('copy',1000).completed,1101);
  assert.equal(service.getState('copy',1000).has_fur.includes(1101),true);
});

test('forced completion stays at current server time and rejects a second claim',t=>{
  const {database,service}=setup(t);kit(database);
  service.put('frog',1,10201,100);service.put('frog',6,10101,100);service.advance('frog',100);
  assert.equal(service.finish('frog',101).completed,1101);
  assert.equal(service.finish('frog',102).ok,false);
  assert.equal(service.getState('frog',102).job,null);
});

test('failed craft write rolls back resource deduction and bench reservation',t=>{
  const {database,service}=setup(t);kit(database);
  service.put('frog',1,10201,100);service.put('frog',6,10101,100);
  const save=service.save.bind(service);
  service.save=()=>{throw Error('simulated persistence error');};
  assert.throws(()=>service.advance('frog',101),/simulated persistence error/);
  assert.equal(database.getInventoryCount('frog',10001),1);
  service.save=save;
  assert.equal(service.getState('frog',101).bench[5],10101);
  assert.equal(service.getState('frog',101).job,null);
});

test('snapshot rejects invalid placement, duplicate tool and invalid job timing',t=>{
  const {database,service}=setup(t);service.getState('frog',100);
  const state=exportFurnitureState(database,'frog');
  validateFurnitureState(state,catalog);
  assert.throws(()=>validateFurnitureState({...state,bench:[10201,10201,...Array(8).fill(-1)]},catalog),/Duplicate bench tool/);
  assert.throws(()=>validateFurnitureState({...state,placed:[{type:1,id:1101}]},catalog),/unowned/);
  assert.throws(()=>validateFurnitureState({...state,placed:[{type:2,id:1001}]},catalog),/Wrong placement/);
  assert.throws(()=>validateFurnitureState({...state,job:{furniture_id:1101,started_at:200,finish_at:100}},catalog),/finish/);
  const job={furniture_id:1101,started_at:100,finish_at:200,tool:[10201],material:[{item_id:10101,count:1},{item_id:10001,count:1}]};
  assert.throws(()=>validateFurnitureState({...state,job:{...job,tool:[99999]}},catalog),/job tool/);
  assert.throws(()=>validateFurnitureState({...state,job:{...job,material:[{item_id:99999,count:1}]}},catalog),/job material/);
  importFurnitureState(database,'frog',null);
  assert.equal(exportFurnitureState(database,'frog'),null);
});

test('management peek projects defaults without creating a state row or account',t=>{
  const {database,service}=setup(t);
  const view=service.peekState('frog',100);
  assert.equal(view.has_fur.includes(1001),true);
  assert.equal(exportFurnitureState(database,'frog'),null);
  service.peekState('unknown-frog',100);
  assert.equal(database.db.prepare('SELECT 1 FROM accounts WHERE account=?').get('unknown-frog'),undefined);
  assert.equal(service.getCatalog().allFurniture.find(x=>x.id===1001).name,'原墙');
});

test('missing catalog neither overwrites a pending craft nor permanently seeds an empty room',t=>{
  const {database,service}=setup(t);kit(database);
  service.put('frog',1,10201,100);service.put('frog',6,10101,100);service.advance('frog',100);
  const saved=exportFurnitureState(database,'frog');
  const unavailable=new FurnitureService(database,{items:[],furniture:[],furnitureShop:[],bench:[]});
  assert.equal(unavailable.advance('frog',1000000).ok,false);
  assert.equal(unavailable.getState('frog',1000000).bench_lock,true);
  assert.deepEqual(exportFurnitureState(database,'frog'),saved);
  unavailable.getState('new-frog',1000000);
  assert.equal(exportFurnitureState(database,'new-frog'),null);
  assert.equal(service.getState('new-frog',1000000).has_fur.includes(1001),true);
  assert.equal(service.advance('frog',1000000).completed,1101);
  assert.equal(service.advance('frog',1000001).changed,false);
});
