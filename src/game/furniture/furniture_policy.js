'use strict';

// These recipes are explicit local approximations. The client proves output,
// drawing and item identities, but does not ship the official server's recipes.
const STYLE_MATERIAL=Object.freeze({2:10101,3:10102,4:10103,5:10104,6:10105,7:10106,8:10107,9:10108,10:10102,11:11001,12:10102,13:10103,14:10101});
const TEXTILE=new Set([7,9,13,19,24,26]);
const STONE=new Set([1,2,20]);
const METAL=new Set([6,22,25]);
function policyForType(type){
  if(TEXTILE.has(type))return {toolKind:4,base:10005};
  if(STONE.has(type))return {toolKind:2,base:10003};
  if(METAL.has(type))return {toolKind:3,base:10007};
  if([10,11,15,21,27].includes(type))return {toolKind:5,base:10002};
  return {toolKind:1,base:10001};
}
function buildFurnitureRecipes(catalog,{craftSeconds=1800}={}){
  if(!Number.isSafeInteger(craftSeconds)||craftSeconds<1)throw Error('Invalid recipe duration');
  const items=new Map((catalog.items||[]).map(x=>[x.id,x]));
  const buildable=new Set((catalog.bench||[]).filter(x=>x.type===1).map(x=>x.id));
  const recipes=[];
  for(const row of catalog.furniture||[]){
    if(!buildable.has(row.id)||!items.has(row.drawing))continue;
    const material=STYLE_MATERIAL[row.style],spec=policyForType(row.type);
    const tools=[...items.values()].filter(x=>x.type===12&&x.id%10===spec.toolKind).map(x=>x.id).sort((a,b)=>a-b);
    if(!items.has(material)||!items.has(spec.base)||!tools.length)continue;
    recipes.push({id:row.id,name:row.name,paper_item_id:row.drawing,material:[{item_id:material,count:1},{item_id:spec.base,count:1}],tool:tools,time:craftSeconds,
      area:row.type,type:row.type,style:row.style,resource:row.res||[],provenance:{output:'client-config',drawing:'client-config',materials:'local-approximation',tool:'local-approximation',time:'local-approximation'}});
  }
  return recipes.sort((a,b)=>a.id-b.id);
}
function planFurnitureCraft(database,account,state,recipes){
  if(state.job||database.getRole(account).frog.status!==0)return null;
  const bench=state.bench||[];
  for(const recipe of recipes){
    if(state.owned.includes(recipe.id)||database.getInventoryCount(account,recipe.paper_item_id)<1)continue;
    const tool=bench.slice(0,5).filter(id=>recipe.tool.includes(id)&&database.getInventoryCount(account,id)>0);
    if(!tool.length)continue;
    const reserved=[],inventory=[];let available=true;
    for(const resource of recipe.material){
      // Special materials physically reside in the last five bench slots.
      // Other base resources stay in warehouse. Identity is supplied by recipe.
      const matches=bench.map((id,index)=>({id,index})).filter(x=>x.index>=5&&x.id===resource.item_id&&!reserved.includes(x.index));
      if(matches.length>=resource.count){reserved.push(...matches.slice(0,resource.count).map(x=>x.index));}
      else if(database.getInventoryCount(account,resource.item_id)>=resource.count&&resource.item_id>=10001&&resource.item_id<=10007){inventory.push({...resource});}
      else {available=false;break;}
    }
    if(available)return {recipe,tool,reserved,inventory};
  }
  return null;
}
function beginFurnitureCraft(service,account,now,recipes=service.recipes){
  return service.database.transaction(()=>{
    const state=service.load(account,now),plan=planFurnitureCraft(service.database,account,state,recipes);
    if(!plan)return {ok:true,code:0,changed:false,itemChanges:[]};
    for(const index of plan.reserved)state.bench[index]=-1;
    const itemChanges=plan.inventory.map(x=>({item_id:x.item_id,count:service.database.changeInventory(account,x.item_id,-x.count)}));
    state.job={furniture_id:plan.recipe.id,started_at:now,finish_at:now+plan.recipe.time,material:plan.recipe.material.map(x=>({...x})),tool:plan.tool};
    service.save(account,state,now);return {ok:true,code:0,changed:true,started:plan.recipe.id,itemChanges};
  });
}
module.exports={STYLE_MATERIAL,policyForType,buildFurnitureRecipes,planFurnitureCraft,beginFurnitureCraft};
