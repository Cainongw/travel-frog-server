'use strict';

// Append to the private APK: align CalendarNoteView's first seasonal task with
// the login substitute and clear MainInView's stale image when a vase empties.
function clientPolicyPatch(){
  if(typeof MainInView!=='undefined'&&!MainInView.prototype.__frogClearEmptyVase){
    var updateDecoration=MainInView.prototype.updateDecoration;
    if(typeof updateDecoration==='function'){
      MainInView.prototype.updateDecoration=function(){
        var result=updateDecoration.apply(this,arguments);
        var model=this.getModel(RoleModel),selected=false;
        for(var i=0;i<model.decorationList.length;i++)if(model.decorationList[i].id===model.decorationPutID&&model.decorationList[i].num>0){selected=true;break;}
        if(!selected&&this.flower)this.flower.source='';
        return result;
      };
      MainInView.prototype.__frogClearEmptyVase=true;
    }
  }
  if(typeof CalendarNoteView==='undefined')return;
  var prototype=CalendarNoteView.prototype;
  if(prototype.__frogCalendarLoginPolicy)return;
  var original=prototype.childrenCreated;
  if(typeof original!=='function')return;
  prototype.childrenCreated=function(){
    var result=original.apply(this,arguments);
    var seasonal=this.data&&this.data.st_days&&this.data.st_days[this.day];
    var task=this.data&&this.data.task_list&&this.data.task_list[0];
    if(seasonal&&task&&this.groupTask&&this.groupTask.visible&&!(this.imageTips&&this.imageTips.visible)){
      var label=this.groupTask.getChildAt(0);
      if(label)label.text='登录游戏（'+(Number(task.pro)||0)+'/1）';
    }
    return result;
  };
  prototype.__frogCalendarLoginPolicy=true;
}
module.exports={clientPolicyPatch};
