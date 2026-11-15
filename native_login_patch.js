'use strict';
// The Android launcher refreshes the login and writes this app-private file.
function nativeLoginPatch(){
  TestChannel.prototype.login=function(done){
    core.PlatformFile.getPath('frog-native-session.json').then(function(path){return core.PlatformFile.readFile(path,false);}).then(function(text){
      var data=JSON.parse(text);if(!data.token)throw Error('Missing login session');
      core.ModelManage.getInstance().getModel(UserModel).setUserInfo({userId:data.token});if(done)done();
    }).catch(function(){core.DisplayManage.getInstance().popup(new ModalAlert('登录会话失效，请关闭游戏后重新打开。'));});
  };
}
module.exports={nativeLoginPatch};
