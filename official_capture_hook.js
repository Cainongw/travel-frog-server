/* Temporary export hook, appended to a backed-up official hot-update script.
 * Does not change channel/endpoints or issue game mutations. Remove after use.
 */
(function () {
  if (window.__frogArchiveCapture) return;
  var state = {format:'frog-official-protocol-capture', version:1, started_at:Date.now(), responses:{}, probes:[], errors:[], complete:false};
  window.__frogArchiveCapture = state;
  var pending={}, queue=[], busy=false, begun=false, dirty=true, writing=false, filename=null;
  var proto=core.SocketManage.prototype, original=proto.AnalysisProtocol;
  function copy(data) { return data===undefined?null:JSON.parse(JSON.stringify(data)); }
  function record(cmd,data,params) {
    if (/^hall_/.test(cmd)) return;
    (state.responses[cmd]||(state.responses[cmd]=[])).push({time:Date.now(),request:copy(params),data:copy(data)}); dirty=true;
  }
  proto.AnalysisProtocol=function(type,raw) {
    try {
      var r=JSON.parse(raw), p=pending[r.session], active=this.activateProtocol[r.session];
      if(p){delete pending[r.session];clearTimeout(p.timer);record(p.cmd,r.data,p.data);state.probes.push({cmd:p.cmd,ok:true});p.done(r.data);return;}
      var cmd=r.cmd?r.cmd.replace('.','_'):active?active.cmd.replace('.','_'):null;
      if(cmd)record(cmd,r.data,active&&active.data);
      if(cmd==='client_load_role'&&!begun){begun=true;setTimeout(start,10000);}
    }catch(e){state.errors.push(String(e));dirty=true;}
    return original.apply(this,arguments);
  };
  function probe(cmd,data,done) {
    var socket=core.SocketManage.getInstance(),session=socket.sessionID+1;
    pending[session]={cmd:cmd,data:data,done:done,timer:setTimeout(function(){delete pending[session];state.probes.push({cmd:cmd,ok:false,error:'timeout'});dirty=true;done(null);},12000)};
    var names=ProtocolList.protocolList[cmd][0];
    var args=[cmd,null];names.forEach(function(key){args.push(data[key]);});
    socket.send.apply(socket,args);
  }
  function next() {
    if(!queue.length){downloadPictures();return;}
    var job=queue.shift();probe(job.cmd,job.data,function(data){
      if(job.cmd==='album_load_all'&&data&&Array.isArray(data.id_list)){
        var ids=data.id_list.map(function(x){return typeof x==='object'?x.id:x;});state.album_expected=ids.length;
        for(var i=0;i<ids.length;i+=20) queue.push({cmd:'album_load_by_id_list',data:{id_list:ids.slice(i,i+20)}});
      }
      setTimeout(next,300);
    });
  }
  function start() {
    // No writes, claims, confirmations, gifts, buys or new trips.
    var commands=['item_load_items','item_load_handbook','item_load_shop_info','album_load_all','album_load_new','album_load_recover','travel_load_gift','travel_load_note','mail_load','story_load','misc_moment_load','encyclopedia_load','encytravel_load','guest_load','visit_load','weather_load','client_load_decorate','furniture_load_furniture','furniture_load_tumbler','furniture_load_compost','furniture_load_pocket','furniture_load_flowerpot','pray_load_grays','guest_load_drawing','recharge_load','task_load','task_load_list','museum_load','museumday_load','museumday_load_path','koto_load','koto_load_path','calendar_load_note','share_load','greetcard_load_count','capsule_load_coin','capsule_load_task','partycake_load_mate','partycake_load_task','partycake_load_qa','springcard_load_count','wishingpool_load','lottery_load','cooking_load_cooking'];
    var album=state.responses.album_load_all;
    if(album&&album.length){
      var records=album[album.length-1].data.id_list||[],ids=records.map(function(x){return typeof x==='object'?x.id:x;});
      state.album_expected=ids.length;
      for(var i=0;i<ids.length;i+=20)queue.push({cmd:'album_load_by_id_list',data:{id_list:ids.slice(i,i+20)}});
    }
    commands.forEach(function(cmd){var def=ProtocolList.protocolList[cmd];if(!state.responses[cmd]&&def&&def[1]&&def[0].length===0)queue.push({cmd:cmd,data:{}});});
    state.server=GameConfig.serverURL;state.account=core.ModelManage.getInstance().getModel(UserModel).getAccount();
    state.read_commands=queue.map(function(x){return x.cmd;});next();
  }
  function downloadPictures(){
    var images=[],seen={};
    Object.keys(state.responses).forEach(function(cmd){state.responses[cmd].forEach(function(r){
      var d=r.data||{},arr=d.pic_list||d.pictures;
      if(!Array.isArray(arr))return;
      arr.forEach(function(p){if(p.layers&&!seen[p.id]){seen[p.id]=true;images.push(p);}});
    });});
    state.assets={expected:images.length,loaded:0,failures:[]};dirty=true;
    function step(){
      var p=images.shift();if(!p){state.complete=true;state.finished_at=Date.now();dirty=true;return;}
      var done=false,timer=setTimeout(function(){finish(false);},20000);
      function finish(ok){if(done)return;done=true;clearTimeout(timer);if(ok)state.assets.loaded++;else state.assets.failures.push(p.id);dirty=true;setTimeout(step,30);}
      try{Tabikaeru.loadPicture(p).then(function(){finish(true);},function(){finish(false);});}catch(e){finish(false);}
    }
    step();
  }
  setInterval(function(){
    if(!dirty||writing)return;
    writing=true;dirty=false;
    var promise=filename?Promise.resolve(filename):core.PlatformFile.getPath('frog-official-export.json').then(function(p){filename=p;return p;});
    promise.then(function(p){return core.PlatformFile.writeFile(p,JSON.stringify(state),false);}).then(function(){writing=false;},function(e){writing=false;dirty=true;state.errors.push(String(e));});
  },2000);
})();
