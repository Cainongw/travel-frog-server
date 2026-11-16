'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),vm=require('node:vm'),{clientPolicyPatch}=require('../tools/android/patches/client_policy_patch');
test('calendar patch changes only the seasonal first task and preserves original initialization and other labels',()=>{
 let calls=0;function CalendarNoteView(){this.day=22;this.data={st_days:{22:30},task_list:[{id:1,pro:1,complete:true},{id:2,pro:5},{id:3,pro:0}]};this.imageTips={visible:false};this.labels=[{text:''},{text:''},{text:''}];this.groupTask={visible:true,getChildAt:i=>this.labels[i]};}
 CalendarNoteView.prototype.childrenCreated=function(marker){calls++;this.labels[0].text='观看广告或完成分享（1/1）';this.labels[1].text='累计获得三叶草（5/30）';this.labels[2].text='商店抽奖兑换奖品（0/1）';return marker;};
 const context={CalendarNoteView};vm.runInNewContext('('+clientPolicyPatch.toString()+')()',context);const view=new CalendarNoteView();assert.equal(view.childrenCreated('original-result'),'original-result');assert.equal(calls,1);assert.equal(view.labels[0].text,'登录游戏（1/1）');assert.equal(view.labels[1].text,'累计获得三叶草（5/30）');assert.equal(view.labels[2].text,'商店抽奖兑换奖品（0/1）');
 const wrapped=CalendarNoteView.prototype.childrenCreated;vm.runInNewContext('('+clientPolicyPatch.toString()+')()',context);assert.equal(CalendarNoteView.prototype.childrenCreated,wrapped,'append is idempotent');
});
test('calendar beginner notes, non-seasonal notes and missing runtime classes are not changed',()=>{
 function CalendarNoteView(){this.day=5;this.data={st_days:{},task_list:[{id:1,pro:1}]};this.imageTips={visible:false};this.first={text:''};this.groupTask={visible:true,getChildAt:()=>this.first};}
 CalendarNoteView.prototype.childrenCreated=function(){this.first.text='original text';};const context={CalendarNoteView};vm.runInNewContext('('+clientPolicyPatch.toString()+')()',context);const normal=new CalendarNoteView();normal.childrenCreated();assert.equal(normal.first.text,'original text');
 const beginner=new CalendarNoteView();beginner.data.st_days[5]=20;beginner.imageTips.visible=true;beginner.childrenCreated();assert.equal(beginner.first.text,'original text');
 assert.doesNotThrow(()=>vm.runInNewContext('('+clientPolicyPatch.toString()+')()',{}));
});
test('vase patch clears the actual MainInView flower image only when selected flower is absent',()=>{
 function RoleModel(){}function MainInView(){this.model={decorationList:[{id:100,num:1}],decorationPutID:100};this.flower={source:'existing-image'};}
 MainInView.prototype.getModel=function(model){assert.equal(model,RoleModel);return this.model;};MainInView.prototype.updateDecoration=function(){if(this.model.decorationPutID===100)this.flower.source='plum-bloom';return 42;};
 const context={MainInView,RoleModel};vm.runInNewContext('('+clientPolicyPatch.toString()+')()',context);const view=new MainInView();assert.equal(view.updateDecoration(),42);assert.equal(view.flower.source,'plum-bloom');
 view.model.decorationPutID=0;view.updateDecoration();assert.equal(view.flower.source,'');view.flower.source='stale';view.model.decorationList=[];view.updateDecoration();assert.equal(view.flower.source,'');
 const wrapped=MainInView.prototype.updateDecoration;vm.runInNewContext('('+clientPolicyPatch.toString()+')()',context);assert.equal(MainInView.prototype.updateDecoration,wrapped);
});
