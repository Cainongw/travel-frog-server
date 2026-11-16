'use strict';
const {EconomyPolicy}=require('./economy_policy');
const {ModuleState}=require('../../core/module_state');
class WorldService{
  constructor(database,catalog,options={}){this.db=database;this.catalog=catalog;this.items=new Map((catalog.items||[]).map(x=>[x.id,x]));this.economy=options.economy||new EconomyPolicy({catalog});this.store=new ModuleState(database);this.clock=options.clock||(()=>Math.floor(Date.now()/1000));this.restSeconds=options.restSeconds||900;this.commands=new Set();}
  initial(account){return this.advance(account).events;}
  advance(account){return this.db.transaction(()=>{
    if(!this.db.economy||this.db.isOfficialReadOnly(account))return {events:[]};
    const now=this.clock(),state=this.store.get(account,'world',{}),events=[],role=this.db.ensureAccount(account),weather=this.economy.weatherAt(now,{seed:account});
    if(!state.weather_manual&&JSON.stringify(this.db.getWeather(account))!==JSON.stringify(weather)){this.db.updateAccount(account,weather);events.push({cmd:'weather_load',data:weather});}
    if(role.frog_status===0){
      const interval=Math.floor(now/600),hour=new Date((now+28800)*1000).getUTCHours();
      if(state.motion_period!==interval){const night=hour>=22||hour<6;const choices=night?[10,11,12,13]:[0,0,1,2,4];const motion=choices[(interval+account.length)%choices.length];this.db.updateAccount(account,{frog_motion:motion});state.motion_period=interval;events.push({cmd:'client_load_role',data:this.db.getRole(account)});}
      const plan=this.store.get(account,'travel-plan',{}),items=this.db.getItemState(account);
      if(!this.db.getTravelState(account)&&!plan.depart_at&&items.bag[0]<0){
        const desk=[...items.desk],bag=[...items.bag],food=desk.findIndex(id=>this.items.get(id)?.type===0);
        if(food>=0){const borrowed=[];for(let i=0;i<bag.length;i++){
          if(bag[i]>=0)continue;const index=i===0?food:desk.findIndex(id=>id>=0&&this.economy.allowsSlot('bag',i+1,id));
          if(index<0)continue;bag[i]=desk[index];desk[index]=-1;borrowed.push({bag:i+1,desk:index+1,item_id:bag[i]});
        }
        this.db.updateAccount(account,{bag_json:JSON.stringify(bag),desk_json:JSON.stringify(desk),bag_completed:1});
        state.borrowed=borrowed;this.store.set(account,'travel-plan',{depart_at:Math.max(now+this.restSeconds,plan.home_at||0)});
        events.push({cmd:'item_load_items',data:this.db.getItemState(account)});
        }
      }
    }
    this.store.set(account,'world',state);return {events};
  });}
}
module.exports={WorldService};
