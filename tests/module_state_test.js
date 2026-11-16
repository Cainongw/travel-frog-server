'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {FrogDatabase}=require('../src/core/database'),{SnapshotService}=require('../src/core/snapshots');
test('module progress exports and rolls back together with inventory while old snapshots restore without new state',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('a');db.ensureAccount('b');
 db.modules.set('a','activity',{claimed:[1],deadline:1000});db.modules.set('b','activity',{claimed:[99]});const saves=new SnapshotService(db);const saved=saves.create('a');
 db.modules.set('a','activity',{claimed:[1,2],deadline:2000});saves.restore('a',saved.id,'a');assert.deepEqual(db.modules.get('a','activity'),{claimed:[1],deadline:1000});assert.deepEqual(db.modules.get('b','activity'),{claimed:[99]});
 const exported=db.exportAccount('a');db.importAccount(exported);assert.deepEqual(db.modules.get('a','activity'),exported.modules.activity);
 const payload=JSON.parse(db.db.prepare('SELECT payload_json FROM admin_snapshots WHERE id=?').get(saved.id).payload_json);delete payload.tables.game_module_state;const json=JSON.stringify(payload);db.db.prepare('UPDATE admin_snapshots SET payload_json=?,sha256=? WHERE id=?').run(json,crypto.createHash('sha256').update(json).digest('hex'),saved.id);
 saves.restore('a',saved.id,'a');assert.deepEqual(db.modules.export('a'),{});assert.deepEqual(db.modules.get('b','activity'),{claimed:[99]});
});
