'use strict';
// Opt-in test build only. Queue lives inside app-private files and is driven by
// the owner's rooted adb session; shipped builds omit this hook.
function qaClientHook(){
  var last='',busy=false,paths=null,record=[],ready=false;
  var original=core.SocketManage.prototype.AnalysisProtocol;
  core.SocketManage.prototype.AnalysisProtocol=function(type,text){
    try{var msg=JSON.parse(text);if(msg.cmd==='client_load_role')ready=true;record.push({cmd:msg.cmd,session:msg.session,data:msg.data});if(record.length>500)record.shift();}catch(e){}
    return original.apply(this,arguments);
  };
  function rpc(action){return new Promise(function(resolve){
    var cmd=action.cmd.replace('.','_'),def=ProtocolList.protocolList[cmd];if(!def){resolve({error:'Unknown protocol '+cmd});return;}
    var socket=core.SocketManage.getInstance(),timer=null;
    var done=false,finish=function(result){if(done)return;done=true;if(timer)clearTimeout(timer);resolve(result);};
    timer=setTimeout(function(){finish({timeout:true});},7000);
    var args=[cmd,new core.Action2(function(data){finish(data);})];def[0].forEach(function(key){args.push((action.data||{})[key]);});
    socket.send.apply(socket,args);if(!def[1])setTimeout(function(){finish({sent:true});},250);
  });}
  function execute(action){
    if(action.type==='rpc')return rpc(action);
    if(action.type==='model'||action.type==='inspect-model'){
      if(!/^[A-Za-z0-9_]+Model$/.test(action.model)||typeof window[action.model]!=='function')return Promise.resolve({error:'Unknown model'});
      var model=core.ModelManage.getInstance().getModel(window[action.model]);
      if(action.type==='inspect-model')return Promise.resolve({model:action.model,data:JSON.parse(JSON.stringify(model.data||model.serverData||{}))});
      if(!/^(?:req_|request_?|set)[A-Za-z0-9_]+$/.test(action.method)||typeof model[action.method]!=='function')return Promise.resolve({error:'Unknown model action'});
      return new Promise(function(resolve){
        var args=(action.args||[]).slice();if(action.callback)args.push(new core.Action1(function(value){resolve({model:action.model,method:action.method,callback:value});}));
        model[action.method].apply(model,args);setTimeout(function(){resolve({model:action.model,method:action.method,sent:true});},1500);
      });
    }
    if(action.type==='navigate'){
      if(!/^[A-Za-z0-9_]+(?:Controller|Control)$/.test(action.controller)||typeof window[action.controller]!=='function')return Promise.resolve({error:'Unknown controller'});
      core.PageManage.getInstance().addViewControl(window[action.controller],core.ViewLayerType.WindowLayer,core.RemoveViewType.RemoveBefore,action.data);
      return new Promise(function(resolve){setTimeout(function(){resolve({opened:action.controller});},600);});
    }
    if(action.type==='close'){core.PageManage.getInstance().removeControl(window[action.controller],core.ViewLayerType.WindowLayer);return Promise.resolve({closed:action.controller});}
    return Promise.resolve({error:'Unknown action'});
  }
  function tick(){
    if(busy||!ready)return;busy=true;
    var init=paths?Promise.resolve(paths):core.PlatformFile.getPath('frog-qa-command.json').then(function(q){return core.PlatformFile.getPath('frog-qa-result.json').then(function(r){paths={queue:q,result:r};return paths;});});
    init.then(function(p){return core.PlatformFile.readFile(p.queue,false);}).then(function(text){
      if(!text)return;var job=JSON.parse(text);if(!job.id||job.id===last)return;last=job.id;record=[];
      var results=[],chain=Promise.resolve();(job.actions||[]).forEach(function(action){chain=chain.then(function(){return execute(action);}).then(function(result){results.push(result);});});
      return chain.then(function(){return new Promise(function(resolve){setTimeout(resolve,500);});}).then(function(){return core.PlatformFile.writeFile(paths.result,JSON.stringify({id:job.id,results:results,protocols:record}),false);});
    }).catch(function(e){console.log('FROG_QA_ERROR '+String(e));}).then(function(){busy=false;});
  }
  setInterval(tick,1500);console.log('FROG_QA_HOOK_READY');
}
module.exports={qaClientHook};
