'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{FrogDatabase}=require('./database');
const {ProtocolDiagnostics,describe}=require('./protocol_diagnostics');
test('unsupported logs aggregate safely and do not contain token or free-text values',()=>{
  const db=new FrogDatabase(':memory:');
  try{
    const log=new ProtocolDiagnostics(db),data={token:'my-secret',message:'private name',id:12,values:[1,'password text'],nested:{authorization:'Bearer hidden'}};
    log.record('a','pray_compose',data);log.record('a','pray_compose',data);log.record('b','pray_compose',{});
    const rows=log.list('a');assert.equal(rows.length,1);assert.equal(rows[0].count,2);assert.equal(rows[0].sample.id,12);
    for(const secret of ['my-secret','private name','password text','Bearer hidden'])assert.ok(!JSON.stringify(rows).includes(secret));
    assert.equal(describe({password:'x'}).password,'[redacted]');
  }finally{db.close();}
});
