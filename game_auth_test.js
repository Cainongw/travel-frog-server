'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{FrogDatabase}=require('./database'),{GameAuth}=require('./game_auth');
test('remembered login survives expired access token; reset, disable and delete revoke refresh without touching saves',async t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());const auth=new GameAuth(db);db.ensureAccount('shared');db.updateAccount('shared',{clover:1234});
 auth.manage({action:'create',username:'dog',password:'password-for-dog',account:'shared'},'admin1');
 auth.manage({action:'create',username:'owner',password:'password-for-owner',account:'shared'},'admin1');
 const dog=await auth.login('dog','password-for-dog','test-dog'),owner=await auth.login('owner','password-for-owner','test-owner');
 db.db.prepare('UPDATE game_sessions SET expires=0 WHERE username=?').run('dog');assert.equal(auth.resolve(dog.token),undefined);
 const reopened=new GameAuth(db);const refreshed=reopened.refresh(dog.refresh_token);assert.equal(reopened.resolve(refreshed.token),'shared');
 auth.manage({action:'set-disabled',username:'dog',disabled:true},'admin1');assert.equal(auth.resolve(refreshed.token),undefined);assert.throws(()=>auth.refresh(dog.refresh_token),/失效/);await assert.rejects(auth.login('dog','password-for-dog','test-dog'),/账号或密码错误/);
 assert.equal(auth.resolve(owner.token),'shared','separate login sharing the same save remains authorized');
 auth.manage({action:'set-disabled',username:'dog',disabled:false},'admin1');const again=await auth.login('dog','password-for-dog','test-dog');
 auth.manage({action:'reset-password',username:'dog',password:'new-password-for-dog'},'admin1');assert.throws(()=>auth.refresh(again.refresh_token),/失效/);
 const changed=await auth.login('dog','new-password-for-dog','test-dog');auth.manage({action:'revoke-sessions',username:'dog'},'admin1');assert.throws(()=>auth.refresh(changed.refresh_token),/失效/);
 const before=db.exportAccount('shared');auth.manage({action:'delete',username:'dog'},'admin1');assert.deepEqual(db.exportAccount('shared'),before,'deleting a login retains its associated game save');
 assert.equal(auth.list().length,1);assert.ok(!JSON.stringify(auth.list()).includes('password'));assert.equal(db.getRole('shared').res.clover_point,1234);
 const audit=db.db.prepare('SELECT username,action,actor FROM game_user_audit').all();assert.equal(audit.length,7);assert.ok(!JSON.stringify(audit).includes('password-for'));
});
test('account management rejects rebinding, unknown archives and invalid changes without partial writes',t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());const auth=new GameAuth(db);db.ensureAccount('a');db.ensureAccount('b');auth.setPassword('dog','original-password','a');
 assert.throws(()=>auth.setPassword('dog','another-password','b'),/其他存档/);
 assert.throws(()=>auth.manage({action:'create',username:'cat',password:'test-password',account:'missing'},'a'),/已有存档/);
 assert.throws(()=>auth.manage({action:'create',username:'dog',password:'test-password',account:'a'},'a'),/已存在/);
 assert.throws(()=>auth.manage({action:'set-disabled',username:'dog',disabled:'true'},'a'),/flag/);
 assert.throws(()=>auth.manage({action:'reset-password',username:'dog',password:'short'},'a'),/密码/);
 assert.equal(auth.list()[0].account,'a');assert.equal(auth.list()[0].disabled,false);
});
