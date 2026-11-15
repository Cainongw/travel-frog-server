'use strict';
// Serialized into the supplied Egret client; server credentials are never baked in.
function gameLoginPatch(origin,title){
  TestChannel.prototype.login=function(done){
    var stage=egret.MainContext.instance.stage;
    var view=new eui.Group();view.width=stage.stageWidth;view.height=stage.stageHeight;
    var bg=new eui.Rect(view.width,view.height,0xf4f0df);view.addChild(bg);
    var box=new eui.Group();box.width=Math.min(560,view.width-60);box.horizontalCenter=0;box.verticalCenter=0;view.addChild(box);
    function label(text,y,size){var v=new eui.Label();v.text=text;v.size=size||26;v.textColor=0x344e3b;v.width=box.width;v.textAlign='center';v.y=y;box.addChild(v);return v;}
    label(title,0,34);label('登录你的旅行青蛙存档',60,24);
    function input(y,secret){var v=new egret.TextField();v.type=egret.TextFieldType.INPUT;v.width=box.width;v.height=65;v.y=y;v.size=28;v.textColor=0x243c2c;v.background=true;v.backgroundColor=0xffffff;v.border=true;v.borderColor=0x9cae97;v.verticalAlign='middle';v.maxChars=secret?128:64;v.displayAsPassword=secret;box.addChild(v);return v;}
    label('游戏账号',100,20);var username=input(130,false);
    label('密码',210,20);var password=input(240,true);
    var message=label('',325,22);message.height=60;message.textColor=0x9c3c30;
    var button=new eui.Group();button.width=box.width;button.height=70;button.y=395;button.touchEnabled=true;button.touchChildren=false;button.addChild(new eui.Rect(box.width,70,0x426b48));var caption=new eui.Label();caption.text='登录';caption.textColor=0xffffff;caption.size=28;caption.horizontalCenter=0;caption.verticalCenter=0;button.addChild(caption);box.addChild(button);
    box.height=465;stage.addChild(view);
    button.addEventListener(egret.TouchEvent.TOUCH_TAP,function(){
      if(!username.text.trim()||!password.text){message.text='请输入账号和密码';return;}
      button.touchEnabled=false;button.alpha=0.6;message.text='正在登录…';
      var request=new egret.HttpRequest();request.responseType=egret.HttpResponseType.TEXT;
      request.addEventListener(egret.Event.COMPLETE,function(){
        try{var data=JSON.parse(request.response);if(!data.token)throw Error(data.error||'登录失败');
          core.ModelManage.getInstance().getModel(UserModel).setUserInfo({userId:data.token});
          password.text='';if(view.parent)view.parent.removeChild(view);if(done)done();
        }catch(e){button.touchEnabled=true;button.alpha=1;message.text=e.message||'登录失败，请重试';}
      },null);
      request.addEventListener(egret.IOErrorEvent.IO_ERROR,function(){button.touchEnabled=true;button.alpha=1;message.text='无法连接服务器或账号密码错误，请重试';},null);
      request.open(origin+'/api/game/login',egret.HttpMethod.POST);request.setRequestHeader('Content-Type','application/json');
      request.send(JSON.stringify({username:username.text.trim(),password:password.text}));
    },null);
  };
}
module.exports={gameLoginPatch};
