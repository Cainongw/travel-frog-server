'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {gameLoginPatch}=require('../tools/android/patches/game_login_patch');
test('packaged login waits for credentials and only enters game after server authentication',()=>{
 const requests=[],stage={stageWidth:720,stageHeight:1280,addChild(x){this.view=x;x.parent=this;},removeChild(x){assert.equal(this.view,x);this.view=null;}};
 class View{constructor(){this.children=[];this.events={};this.text='';}addChild(x){this.children.push(x);x.parent=this;}addEventListener(e,fn){this.events[e]=fn;}}
 class Field extends View{}
 class Request extends View{constructor(){super();requests.push(this);}open(url,method){this.url=url;this.method=method;}setRequestHeader(){}send(data){this.body=JSON.parse(data);}}
 let identity,entered=0;function Channel(){};
 const context={TestChannel:Channel,egret:{MainContext:{instance:{stage}},TextField:Field,TextFieldType:{INPUT:'input'},TouchEvent:{TOUCH_TAP:'tap'},HttpRequest:Request,HttpResponseType:{TEXT:'text'},HttpMethod:{POST:'POST'},Event:{COMPLETE:'complete'},IOErrorEvent:{IO_ERROR:'error'}},eui:{Group:View,Rect:View,Label:View},core:{ModelManage:{getInstance:()=>({getModel:()=>({setUserInfo:v=>identity=v})})}},UserModel:function(){}};
 vm.runInNewContext('('+gameLoginPatch.toString()+')('+JSON.stringify('https://frog.example')+','+JSON.stringify('狗狗特供版')+')',context);
 new Channel().login(()=>entered++);assert.equal(entered,0);assert.equal(requests.length,0);
 const box=stage.view.children[1],inputs=box.children.filter(x=>x instanceof Field),button=box.children.at(-1);
 assert.equal(inputs[1].displayAsPassword,true);
 inputs[0].text='dog';inputs[1].text='test-password';button.events.tap();assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://frog.example/api/game/login');assert.equal(requests[0].body.password,'test-password');
 requests[0].response=JSON.stringify({error:'账号或密码错误'});requests[0].events.complete();assert.equal(entered,0);assert.equal(button.touchEnabled,true);
 button.events.tap();requests[1].response=JSON.stringify({token:'server-issued-token'});requests[1].events.complete();
 assert.equal(identity.userId,'server-issued-token');assert.equal(entered,1);assert.equal(stage.view,null);assert.equal(inputs[1].text,'');
});
