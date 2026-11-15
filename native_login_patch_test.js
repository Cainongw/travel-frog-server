'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),vm=require('node:vm');const {nativeLoginPatch}=require('./native_login_patch');
test('game consumes only the authenticated app-private native session without its own login form',async()=>{
 let path,identity,entered=0,message;function Channel(){}
 const context={TestChannel:Channel,UserModel:function(){},ModalAlert:function(text){this.text=text;},core:{PlatformFile:{getPath:async p=>{path=p;return '/private/'+p;},readFile:async()=>JSON.stringify({token:'native-token',account:'shared'})},ModelManage:{getInstance:()=>({getModel:()=>({setUserInfo:v=>identity=v})})},DisplayManage:{getInstance:()=>({popup:v=>message=v.text})}}};
 vm.runInNewContext('('+nativeLoginPatch.toString()+')()',context);new Channel().login(()=>entered++);await new Promise(r=>setImmediate(r));assert.equal(path,'frog-native-session.json');assert.equal(identity.userId,'native-token');assert.equal(entered,1);assert.equal(message,undefined);
 context.core.PlatformFile.readFile=async()=>'{invalid';new Channel().login(()=>entered++);await new Promise(r=>setImmediate(r));assert.equal(entered,1);assert.match(message,/重新打开/);
});
