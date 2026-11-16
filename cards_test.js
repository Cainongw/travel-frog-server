'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {FrogDatabase}=require('./database'),{ModuleState}=require('./module_state'),{CardsService}=require('./cards');
const catalog={items:[{id:0,type:0},{id:47,type:0},{id:48,type:0},{id:1000,type:1},{id:10001,type:10},{id:200001,type:14},{id:8002,type:8},{id:203004,type:14},{id:3000,type:3},{id:3001,type:3},{id:3002,type:3}],neighbors:[{id:0,taste:[20,50,90]}],specialties:[{itemId:3000},{itemId:3001},{itemId:3002}],config:{
 greetCard_json:{bg_list:[{id:1},{id:2}],bg_price:[100,150],tags_price:20,tags:[{id:101,type:1},{id:102,type:2},{id:103,type:3},{id:104,type:1}],bless:[{id:1}],send_reward:{select_list:[47,48],random_list:[1000]}},
 springCard_json:{bg_list:[{id:1}],tags_price:20,tags_share_limit:3,tags:[{id:101,type:1,task_weight:100,buy_weight:100},{id:102,type:2,task_weight:100,buy_weight:100},{id:103,type:3,task_weight:100,buy_weight:100}],bless:[{id:1}],small_box_id:200009,big_box_id:200010},
 PartyCakeData_json:{cake:{1:{time:1,layers:{1:{layer:1,cream:2,sugar:1,item_id:200001,item_num:2},2:{layer:2,cream:2,sugar:1,item_id:47,item_num:1}}},2:{time:1,layers:{1:{layer:1,cream:2,sugar:1,item_id:10001,item_num:1}}}},light_reward:{item_id:203004,item_num:1},task_list:{1:{name:'login',total:1,cream:2,sugar:1},2:{name:'shop',total:2,cream:3,sugar:1},3:{name:'raffle',total:1,cream:2,sugar:1},4:{name:'ad',total:1,cream:2,sugar:1},5:{name:'share',total:1,cream:2,sugar:1},6:{name:'travel',total:1,cream:2,sugar:1}},share_reward:[47,48]},
}};
function setup(t){const database=new FrogDatabase(':memory:');t.after(()=>database.close());for(const name of ['frog','other'])database.ensureAccount(name);let now=1000;const store=new ModuleState(database),service=new CardsService(database,catalog,{stateStore:store,now:()=>now,randomInt:()=>0,cardReplySeconds:60});const call=(cmd,data={},account='frog')=>service.handle(account,cmd,data);return {database,store,service,call,time:value=>now=value};}
function prepareCard(call,module,bg=1){if(module==='greetcard')assert.equal(call(module+'_buy',{id:bg}).response.code,0);assert.equal(call(module+'_change_bg',{id:bg}).response.code,0);assert.equal(call(module+'_get_task_reward').response.code,0);for(let slot=1;slot<=3;slot++)assert.equal(call(module+'_put_tags',{pos:slot,id:100+slot}).response.code,0);assert.equal(call(module+'_change_bless',{id:1}).response.code,0);}

test('greeting cards buy and reserve resources, send, claim configured rewards once and receive an offline local reply',t=>{
 const {database,service,call,time}=setup(t);database.updateAccount('frog',{clover:500});prepareCard(call,'greetcard');
 assert.equal(database.getRole('frog').res.clover_point,400);assert.equal(call('greetcard_buy',{id:1}).response.code,1,'one background per stock round');
 assert.equal(call('greetcard_send').response.code,0);assert.equal(call('greetcard_send').response.code,1);assert.equal(call('greetcard_load').response.send_list.length,1);
 assert.equal(call('greetcard_get_reward',{id:999}).response.code,1);assert.equal(call('greetcard_get_reward',{id:47}).response.code,0);assert.equal(call('greetcard_get_reward',{id:47}).response.code,1);
 assert.equal(database.getInventoryCount('frog',47),1);assert.equal(database.getInventoryCount('frog',1000),1);
 time(1059);service.advance('frog');assert.equal(call('greetcard_load').response.get_list.length,0);time(1060);service.advance('frog');assert.equal(call('greetcard_load').response.get_list.length,1);assert.equal(call('greetcard_load').response.new_index,1);
 assert.equal(call('greetcard_read_new').response.code,0);service.advance('frog');assert.equal(call('greetcard_load').response.get_list.length,1,'reply is only delivered once');
 database.changeInventory('frog',3000,1);assert.equal(call('greetcard_send_gift',{index:1,gift:3000}).response.code,0);assert.equal(call('greetcard_send_gift',{index:1,gift:3000}).response.code,1);assert.equal(database.getInventoryCount('frog',3000),0);
 time(1120);service.advance('frog');const mail=database.getMails('frog').find(x=>x.title==='小伙伴的回礼');assert.ok(mail);assert.equal(call('greetcard_feedback_gift',{id:mail.id}).response.code,0);assert.equal(database.openMail('frog',mail.id).ok,true);assert.equal(database.openMail('frog',mail.id).ok,false);
});

test('greeting sticker replacement returns old stock, rejects duplicate categories and stock replenish requires exhausted backgrounds',t=>{
 const {database,call,store}=setup(t);database.updateAccount('frog',{clover:500});call('greetcard_get_task_reward');call('greetcard_buy',{id:104});
 assert.equal(call('greetcard_put_tags',{pos:1,id:101}).response.code,0);assert.equal(call('greetcard_put_tags',{pos:2,id:104}).response.code,1);assert.equal(call('greetcard_put_tags',{pos:1,id:104}).response.code,0);
 assert.equal(call('greetcard_load').response.items.find(x=>x.item_id===101).num,1);assert.equal(call('greetcard_stock').response.code,1);
 const state=store.get('frog','greetcard');state.items.push({item_id:1,num:0},{item_id:2,num:0});store.set('frog','greetcard',state);assert.equal(call('greetcard_stock').response.code,0);assert.equal(call('greetcard_load').response.stock_num,1);
 assert.equal(call('greetcard_buy',{id:1}).response.code,0);assert.equal(database.getRole('frog').res.clover_point,330,'second stock background uses configured price');
});

test('spring cards consume stickers, create boxes, grant a reward once and enforce daily sticker purchases',t=>{
 const {database,call,time}=setup(t);database.updateAccount('frog',{clover:100});prepareCard(call,'springcard');
 assert.equal(call('springcard_send').response.box_id,200009);assert.equal(call('springcard_get_reward').response.id,200001);assert.equal(database.getRole('frog').res.ticket,1);assert.equal(call('springcard_get_reward').response.code,1);
 for(let i=0;i<3;i++)assert.equal(call('springcard_buy').response.tags_id,101);assert.equal(call('springcard_buy').response.code,1);assert.equal(database.getRole('frog').res.clover_point,40);
 time(87400);assert.equal(call('springcard_load').response.buy_num,0);assert.equal(call('springcard_get_task_reward').response.code,0);assert.equal(call('springcard_get_task_reward').response.code,1);
});

test('spring sticker exchange uses a real one-use code and atomically prevents own, duplicate and expired claims',t=>{
 const {call,database,time}=setup(t);call('springcard_get_task_reward');const shared=call('springcard_share_tags',{tags_id:101});assert.equal(shared.response.code,0);const code=shared.response.share_code;assert.ok(code);
 assert.equal(call('springcard_get_share_tags',{share_code:code}).response.code,1,'cannot exchange own code');assert.equal(call('springcard_get_share_tags',{share_code:code},'other').response.tags_id,101);assert.equal(call('springcard_get_share_tags',{share_code:code},'other').response.code,1,'one-use globally');
 const again=call('springcard_share_tags',{tags_id:102}).response.share_code;time(87401);assert.equal(call('springcard_get_share_tags',{share_code:again},'other').response.code,1,'code expires in one day');
 assert.equal(database.getRole('frog').res.clover_point,0,'exchange never invents a clover reward');
});

test('cake task progress originates in committed gameplay actions and materials cannot be claimed twice',t=>{
 const {database,call,service}=setup(t);service.initial('frog');service.observe('frog','hall_login');assert.equal(call('partycake_load_mate').response.pre_cream,2);
 service.observe('frog','hall_login');assert.equal(call('partycake_load_mate').response.pre_cream,2);service.observe('frog','item_buy');assert.equal(call('partycake_load_mate').response.pre_cream,2);service.observe('frog','item_buy');assert.equal(call('partycake_load_mate').response.pre_cream,5);
 assert.equal(call('partycake_get_mate').response.code,0);assert.equal(call('partycake_get_mate').response.code,1);assert.equal(call('partycake_load').response.cream,5);assert.equal(database.getRole('frog').res.clover_point,0);
});

test('cake construction, questions, rewards and candle reach completion with once-only stage settlement',t=>{
 const {database,call,store}=setup(t);call('partycake_load');const state=store.get('frog','partycake');state.cream=20;state.sugar=10;store.set('frog','partycake',state);
 assert.equal(call('partycake_make',{layer:1}).response.state,1);assert.equal(call('partycake_make',{layer:1}).response.code,1);assert.equal(call('partycake_reward_make').response.state,0);assert.equal(database.getRole('frog').res.ticket,2);assert.equal(call('partycake_reward_make').response.code,1);
 assert.equal(call('partycake_make',{layer:2}).response.state,1);assert.equal(call('partycake_reward_make').response.state,2);assert.equal(call('partycake_load_qa').response.answer.length,3);
 assert.equal(call('partycake_answer',{index:3}).response.state,3);assert.equal(call('partycake_reward_qa').response.state,0);assert.equal(call('partycake_reward_qa').response.code,1);assert.equal(call('partycake_load').response.part,2);
 assert.equal(call('partycake_make',{layer:1}).response.state,1);assert.equal(call('partycake_reward_make').response.state,2);assert.equal(call('partycake_answer',{index:3}).response.state,3);assert.equal(call('partycake_reward_qa').response.state,4);
 assert.equal(call('partycake_light').response.state,5);assert.equal(call('partycake_light').response.code,1);assert.equal(call('partycake_reward_light').response.state,6);assert.equal(call('partycake_reward_light').response.code,1);assert.equal(database.getInventoryCount('frog',203004),1);
 assert.equal(call('partycake_reward_share',{index:1}).response.code,1,'share claim cannot pretend external verification succeeded');
});

test('failed reward persistence rolls back card and cake resources and no activity leaks across accounts',t=>{
 const {database,call,store}=setup(t);database.updateAccount('frog',{clover:500});prepareCard(call,'greetcard');call('greetcard_send');const original=store.set.bind(store);store.set=()=>{throw Error('storage failed');};
 assert.throws(()=>call('greetcard_get_reward',{id:47}),/storage failed/);assert.equal(database.getInventoryCount('frog',47),0);store.set=original;assert.equal(call('greetcard_get_reward',{id:47}).response.code,0);assert.equal(database.getInventoryCount('frog',47),1);assert.equal(database.getInventoryCount('other',47),0);
});

test('greeting history, pending replies and cake stage survive export/import and snapshot rollback',t=>{
 const {database,call,service,store}=setup(t);database.updateAccount('frog',{clover:500});prepareCard(call,'greetcard');call('greetcard_send');service.initial('frog');
 const {SnapshotService}=require('./snapshots'),snapshots=new SnapshotService(database),snapshot=snapshots.create('frog','card-before-claim');
 call('greetcard_get_reward',{id:47});snapshots.restore('frog',snapshot.id,'frog');assert.equal(call('greetcard_load').response.can_reward,true);assert.equal(database.getInventoryCount('frog',47),0);assert.equal(store.get('frog','greetcard').pending_replies.length,1);
 const save=database.exportAccount('frog');database.importAccount(save,true);assert.equal(call('greetcard_load').response.send_list.length,1);assert.equal(store.get('frog','greetcard').pending_replies.length,1);
});
