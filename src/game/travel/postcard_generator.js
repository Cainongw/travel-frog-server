'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readBundle, resourceImage } = require('../../core/catalog');

const ACTORS = Object.freeze(['bh', 'cw', 'yhc']);
// Retired Goal definitions kept their IDs, but their old backgrounds no longer
// ship. Each replacement is explicitly confined to the same named destination.
// In particular the old Changbaishan group was replaced by the Jilin group;
// the candidate locations still explicitly say 吉林·长白山.
const RETIRED_SCENE_FALLBACKS=Object.freeze({
  2033:{name:'xianggang3',location:'香港',place:11,sources:[2031,2032,2034]},
  2035:{name:'xianggang5',location:'香港',place:11,sources:[2031,2032,2034]},
  2040:{name:'changbaishan1',location:'吉林·长白山',place:30,sourceLocation:'吉林·长白山',sources:[2126,2127,2128,2129]},
  2041:{name:'changbaishan2',location:'吉林·长白山',place:30,sourceLocation:'吉林·长白山',sources:[2126,2127,2128,2129]},
  2042:{name:'changbaishan3',location:'吉林·长白山',place:30,sourceLocation:'吉林·长白山',sources:[2126,2127,2128,2129]},
  2075:{name:'hainan3',location:'海南',place:21,sources:[2073,2074,2078]},
  2076:{name:'hainan4',location:'海南',place:21,sources:[2073,2074,2078]},
});
// The artwork uses both full place names and these historic resource labels.
// These are name aliases, not a replacement probability/route table.
const PLACE_ALIASES = Object.freeze({ beijing:'bj',chengdu:'cd',chongqing:'cq',guangzhou:'gz',guilin:'gl',hangzhou:'hz',suzhou:'sz',tianjin:'tj',xianggang:'xg',haerbin:'heb',changbaishan:'cbs',zhangjiajie:'zjj',wuhan:'wh',luoyang:'ly',xian:'xa',jiuquan:'jq',yunnan:'yn',lasa:'ls',shanghai:'sh',hainan:'hn',guizhou:'guiz',ningxia:'nx',fujian:'fj',jiangxi:'jx',anhui:'ah',jiangmen:'jm',liaoning:'ln',qingdao:'qd',bwgjiangxi:'bwgjx',bwgshandong:'bwgsd',bwgnanyuewang:'bwgnyw',bwgwuwenhua:'bwgwwh',bwgshanxi:'bwgsx',twjingan:'twja',twlanyu:'twly',twtiandeng:'twtd',twzuinandian:'twznd',shifen:'twsf',twshifen:'twsf',kengding:'twkd',twkending:'twkd' });
const clone = value => JSON.parse(JSON.stringify(value));
const normalized = name => String(name).toLowerCase().replace(/^back_/, '').replace(/^rnd_/, '').replace(/^pose_/, '').replace(/^(?:g|n|u)_/, '').replace(/_xyn_/g,'_').replace(/_pose(?=_|$)/g, '').replace(/[^a-z0-9]/g, '');
function poseAliases(name) {
  const value = normalized(name), aliases = new Set([value]);
  for (const [full, short] of Object.entries(PLACE_ALIASES)) if (value.startsWith(full)) aliases.add(short+value.slice(full.length));
  // Legacy Taiwan spelling includes a trailing scene index in Picture.name.
  if (value==='twshifen1') aliases.add('twsf');
  if (value==='twkending1') aliases.add('twkd');
  return aliases;
}
function actorOf(name) { const match=String(name).toLowerCase().match(/(?:^|_)(qw|2qw|bh|cw|yhc)(?:_|$)/);return match?.[1] || null; }
function roleOf(asset){return asset.type==='Unique'&&asset.width>=500&&asset.height>=350?null:actorOf(asset.base);}
function spriteStem(name) { return normalized(String(name).replace(/(?:^|_)(?:qw|2qw|bh|cw|yhc)(?=_|$)/ig,'_')); }

/**
 * Composes layer records from caller-supplied client assets and optional real
 * postcard samples. This module neither reads a save DB nor changes an account.
 */
class PostcardGenerator {
  constructor(options = {}) {
    this.root=options.root || options.catalog?.root;
    this.config=options.config || (this.root ? readBundle(path.join(this.root,'eab','config.eab')) : {});
    this.pictures = new Map((options.pictures || options.catalog?.pictures || this.config.Picture_json || []).map(p=>[p.id,p]));
    this.resources = options.resources || options.catalog?.resources || this.config.resources_json || {};
    this.random=options.random || Math.random;
    this.loadImage=options.loadImage || (id=>{
      const name=this.resources[id];
      if (!/^Picture\/[\w/.-]+$/.test(name)||name.split('/').includes('..')) throw Error('Invalid picture resource path');
      const direct=path.join(this.root,'images',name+'.png');
      if (fs.existsSync(direct)) {
        const bytes=fs.readFileSync(direct);
        if (bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return bytes;
      }
      return resourceImage({root:this.root,resources:this.resources},id);
    });
    this.assets=new Map();this.missing=[];this.byName=new Map();this.samples=new Map();this.positions=new Map();
    for(const [key,name] of Object.entries(this.resources)){
      const id=Number(key);if(!Number.isSafeInteger(id)||id<0||typeof name!=='string')continue;
      try{
        const bytes=this.loadImage(id);
        if(!Buffer.isBuffer(bytes)||bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('Invalid PNG');
        const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
        if(width<1||height<1||width>10000||height>10000)throw Error('Invalid PNG dimensions');
        const asset={id,name,base:path.posix.basename(name),type:name.split('/')[1],width,height};
        this.assets.set(id,asset);
        const norm=normalized(asset.base);if(!this.byName.has(norm))this.byName.set(norm,[]);this.byName.get(norm).push(asset);
      }catch(error){this.missing.push({id,name,reason:error.message});}
    }
    this.addSamples(options.samples || []);
    this.definitions=new Map();
    for(const picture of this.pictures.values())this.definitions.set(picture.id,this.compile(picture));
    this.configureRetiredFallbacks(options.enableRetiredFallbacks!==false);
  }
  roll(){const value=this.random();if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)throw Error('Random source must return a number in [0,1)');return value;}
  pick(values){if(!values.length)throw Error('No matching postcard configuration');return values[Math.floor(this.roll()*values.length)];}
  addSamples(input){
    // Accept a save's postcard array or the exact capture response table. No
    // identity, balances, mail text, or credentials are copied to the model.
    let samples=Array.isArray(input)?input:input?.postcards;
    if(!samples){const protocols=input?.protocols || input?.responses || input || {};samples=[];for(const [cmd,value]of Object.entries(protocols)){
      if(!/album|travel_load_gift/.test(cmd))continue;
      const records=Array.isArray(value)&&value.some(x=>x?.data)?value:[{data:value}];
      for(const r of records){const d=r.data||{};for(const arr of [d.pic_list,d.pictures])if(Array.isArray(arr))samples.push(...arr);}
    }}
    for(const sample of samples || []){
      if(!this.pictures.has(sample.pic_id)||!Array.isArray(sample.layers)||!sample.layers.length)continue;
      if(sample.layers.some(x=>!Array.isArray(x?.layer)||x.layer.length!==3||!this.assets.has(x.layer[0])||!x.layer.slice(1).every(Number.isFinite)))continue;
      const layers=clone(sample.layers),key=JSON.stringify(layers);
      const list=this.samples.get(sample.pic_id)||[];if(list.some(x=>x.key===key))continue;
      list.push({key,layers});this.samples.set(sample.pic_id,list);
      for(const {layer:[id,x,y]}of layers){if(roleOf(this.assets.get(id)))continue;const positions=this.positions.get(id)||[];positions.push([x,y]);this.positions.set(id,positions);}
    }
  }
  named(token,type){
    const norm=normalized(token),exact=this.byName.get(norm)||[];
    const preferred=exact.filter(x=>!type||x.type===type);
    return preferred.length?preferred:exact;
  }
  actorCandidates(picture,pose,actor){
    if(!pose)return [];
    const aliases=poseAliases(pose);
    // In the old normal scene table, pose_beach1_2 is beach1_2qw.
    if(actor==='qw'&&/\d2$/.test(normalized(pose)))aliases.add(normalized(pose).slice(0,-1));
    const expectedTypes=new Set(picture.type==='Unique'?['Unique','Normal']:[picture.type]);
    let candidates=[...this.assets.values()].filter(a=>expectedTypes.has(a.type)&&(actorOf(a.base)===actor||(actor==='qw'&&actorOf(a.base)==='2qw'))&&aliases.has(spriteStem(a.base)));
    // Some initial Tools drawings predate the actor suffix convention.
    if(actor==='qw'&&picture.type==='Tools') candidates.push(...this.named(pose,picture.type).filter(x=>!actorOf(x.base)));
    if(actor==='qw'&&picture.type==='Goal'&&normalized(pose).endsWith('alone'))candidates.push(...this.named(pose,picture.type));
    if(picture.type==='Tools'&&actor!=='qw'){
      const family=normalized(pose).match(/^(wet|dry|fuza)/)?.[1];
      if(family)candidates.push(...this.named(family+'_'+actor,picture.type));
    }
    // chuisihaitang uses a shared sitting sprite for mt/dx scene variants;
    // fenglingmu shares qw/yhc but has h/z variants for the two other actors.
    if(!candidates.length&&picture.type==='Normal'){
      const base=normalized(pose).replace(/(?:mt|dx)$/,'');
      for(const a of this.assets.values())if(a.type===picture.type&&actorOf(a.base)===actor){
        const stem=spriteStem(a.base);
        if(stem===base || stem===base.replace(/(?:h|z)$/,''))candidates.push(a);
      }
    }
    const seen=new Set();return candidates.filter(x=>!seen.has(x.id)&&seen.add(x.id));
  }
  compile(picture){
    const unresolved=[],backs=[],fronts=[];
    const layer=(token,list)=>{
      let matches=this.named(token,picture.type);
      if(!matches.length&&token.startsWith('rnd_')){
        const prefix=normalized(token.slice(4));matches=[...this.assets.values()].filter(x=>x.type===picture.type&&!actorOf(x.base)&&normalized(x.base).startsWith(prefix));
      }
      if(!matches.length)unresolved.push(token);else list.push({token,matches});
    };
    for(const name of picture.backImage||[])layer(name,backs);for(const name of picture.frontImage||[])layer(name,fronts);
    const soloPose=picture.frogPose_s || picture.frogPose;
    const frogSolo=this.actorCandidates(picture,soloPose,'qw');
    // An empty group frogPose with nonempty travelerPose means the companion
    // image already contains the frog (e.g. chuisihaitang_mt_pose_bh).
    const frogTogether=this.actorCandidates(picture,picture.frogPose,'qw');
    if(soloPose&&!frogSolo.length){
      // The source sometimes gives a logical pose alias absent from the asset
      // label. A captured layer from this exact scene can resolve that alias.
      const observed=(this.samples.get(picture.id)||[]).flatMap(s=>s.layers.map(x=>this.assets.get(x.layer[0]))).filter(a=>roleOf(a)==='qw');
      frogSolo.push(...observed);if(picture.frogPose)frogTogether.push(...observed);
      if(!observed.length)unresolved.push('frog:'+soloPose);
    }
    const companions=ACTORS.map((actor,index)=>this.actorCandidates(picture,picture.travelerPose?.[index],actor));
    return {picture,backs,fronts,frogSolo,frogTogether,companions,unresolved,available:backs.length>0&&!unresolved.length};
  }
  configureRetiredFallbacks(enabled){
    for(const def of this.definitions.values()){
      if(def.available)continue;
      // A real, fully readable capture of the exact missing scene is stronger
      // evidence than any substitute. Preserve its coherent whole composition.
      if(this.samples.has(def.picture.id)){def.available=true;def.observedOnly=true;continue;}
      const policy=RETIRED_SCENE_FALLBACKS[def.picture.id];
      if(!enabled||!policy||def.picture.type!=='Goal'||def.picture.name!==policy.name||def.picture.location!==policy.location)continue;
      const sources=policy.sources.map(id=>this.definitions.get(id)).filter(source=>source&&source.available&&!source.observedOnly&&source.picture.type==='Goal'&&source.picture.place===policy.place&&(!policy.sourceLocation||String(source.picture.location).startsWith(policy.sourceLocation)));
      if(!sources.length)continue;
      // Enrich only the compiled definition, leaving the supplied config intact.
      // TravelPolicy can then apply the same destination/food weighting normally.
      def.picture={...def.picture,place:policy.place};def.fallbackSources=sources;def.fallbackPlace=policy.place;def.available=true;
    }
  }
  companionIds(def){
    const definitions=def.fallbackSources||[def];
    return [...new Set(definitions.flatMap(d=>d.companions.flatMap((a,i)=>a.length?[i]:[])))];
  }
  fallbackCandidates(def,context){
    const sources=(def.fallbackSources||[]).filter(source=>context.preview||context.season==null||this.seasons(source.picture).includes(context.season));
    // Captured same-place layouts rank ahead of inferred layouts, while still
    // retaining the requested actor/season restrictions of the source scene.
    const actor=context.companionId;
    const compatible=actor>=0?sources.filter(source=>source.companions[actor]?.length):sources;
    const candidates=compatible.length?compatible:sources;
    const observed=candidates.filter(source=>this.samples.has(source.picture.id));
    return observed.length?observed:candidates;
  }
  seasons(picture){
    if(Array.isArray(picture.seasons))return picture.seasons;
    const name=picture.name.toLowerCase();
    if(/redleaves|yellowleaves/.test(name))return [3];
    if(/rime|lamei/.test(name))return [4];
    if(/lanhuateng|chuisihaitang|mumianhua|fenglingmu/.test(name))return [1];
    return [1,2,3,4];
  }
  toolRequirement(picture){
    if(picture.type!=='Tools')return null;
    const id=picture.id;
    if(id>=1000&&id<=1003)return id===1000?null:2002+(id-1000);
    if(id>=1004&&id<=1007)return id===1004?null:2005+(id-1004);
    if(id>=1008&&id<=1011)return id===1008?null:1999+(id-1008);
    if(id>=1012&&id<=1027)return id%4===0?null:2008+id%4;
    return null;
  }
  eligible(context={}){
    const toolIds=new Set(context.tools||[]),types=new Set(context.allowedTypes||(context.picId!=null?['Normal','Goal','Tools','Unique']:['Normal','Goal','Tools']));
    return [...this.definitions.values()].filter(def=>{
      const p=def.picture;if(!def.available||!types.has(p.type))return false;
      if(context.picId!=null&&p.id!==context.picId)return false;
      if(context.place!=null&&(p.place??def.fallbackPlace)!==context.place)return false;
      if(context.tags?.length&&!context.tags.some(tag=>(this.config.PictureTag_json||[]).some(t=>(t.Tag===tag||t.id===tag)&&t.picNames.includes(p.name))))return false;
      if(!context.preview&&context.season!=null&&!this.seasons(p).includes(context.season))return false;
      if(def.fallbackSources&&!this.fallbackCandidates(def,context).length)return false;
      const required=this.toolRequirement(p);return !!context.preview||required===null||toolIds.has(required);
    });
  }
  fixedPosition(asset, picture, front=false){
    const samples=this.positions.get(asset.id);
    if(samples?.length)return clone(this.pick(samples));
    // Full-canvas backgrounds/foregrounds need no server-only layout table.
    // Fragment coordinates outside observed scenes use an explicit approximation.
    if(asset.width>=500&&asset.height>=350)return [(500-asset.width)/2,(350-asset.height)/2];
    if(picture.randomSet){
      const name=asset.base.toLowerCase();
      if(/sky|cloud|bird|firefly|rain/.test(name))return [(500-asset.width)/2,0];
      if(/mou_back|sea|branch_back/.test(name))return [(500-asset.width)/2,(350-asset.height)/2];
      return [(500-asset.width)/2,350-asset.height];
    }
    return [(500-asset.width)/2,front?350-asset.height:(350-asset.height)/2];
  }
  characterLayer(asset,pos){return {layer:[asset.id,250+Number(pos?.x||0)-asset.width/2,175-Number(pos?.y||0)-asset.height/2]};}
  generate(id,context={}){
    if(!Number.isSafeInteger(id)||id<1)throw Error('Postcard id must be a positive integer');
    if(context.companionId!=null&&(!Number.isInteger(context.companionId)||context.companionId< -1||context.companionId>2))throw Error('Invalid companion id');
    if(context.season!=null&&(!Number.isInteger(context.season)||context.season<1||context.season>4))throw Error('Invalid season');
    const eligible=this.eligible(context),def=this.pick(eligible),p=def.picture;
    if(def.observedOnly){
      const picture={id,pic_id:p.id,layers:clone(this.pick(this.samples.get(p.id)).layers),for_ads:false,visit:false};this.validate(picture);return picture;
    }
    if(def.fallbackSources){
      const source=this.pick(this.fallbackCandidates(def,context));
      const picture=this.compose(id,source,context);picture.pic_id=p.id;this.validate(picture);return picture;
    }
    return this.compose(id,def,context);
  }
  compose(id,def,context){
    const p=def.picture;
    let companion=context.companionId;
    if(companion==null)companion=this.pick([-1,...def.companions.flatMap((values,i)=>values.length?[i]:[])]);
    if(companion>=0&&!def.companions[companion].length)companion=-1;
    const samples=this.samples.get(p.id)||[];
    let layers=[];
    // Observed backgrounds retain their coherent layer order/offsets. Character
    // sprites can still vary using the same config anchor and actor definitions.
    if(samples.length){
      const replaceActors=!!(p.frogPose||p.frogPose_s);
      const sample=this.pick(samples);layers=clone(sample.layers).filter(x=>x.layer[0]!==0&&(!replaceActors||!roleOf(this.assets.get(x.layer[0]))));
      // Legacy unsuffixed Tools frog drawings need removal as well.
      const legacyIds=new Set([...def.frogSolo,...def.frogTogether].map(a=>a.id));layers=layers.filter(x=>!legacyIds.has(x.layer[0]));
    }
    const backLayers=samples.length?layers: def.backs.map(row=>{const a=this.pick(row.matches);return {layer:[a.id,...this.fixedPosition(a,p)]};});
    const foregroundIds=new Set(def.fronts.flatMap(x=>x.matches.map(a=>a.id)));
    const frontLayers=samples.length?backLayers.filter(x=>foregroundIds.has(x.layer[0])):def.fronts.map(row=>{const a=this.pick(row.matches);return {layer:[a.id,...this.fixedPosition(a,p,true)]};});
    layers=backLayers.filter(x=>!foregroundIds.has(x.layer[0]));
    const frog=companion<0?def.frogSolo:def.frogTogether;
    const characters=[];
    if(frog.length)characters.push(this.characterLayer(this.pick(frog),companion<0?p.frogPos_s||p.frogPos:p.frogPos));
    if(companion>=0)characters.push(this.characterLayer(this.pick(def.companions[companion]),p.travelerPos?.[companion]));
    // Config coordinates are center-based/y-up; render back-to-front, higher
    // characters first. This agrees with the observed branch overlap order.
    characters.sort((a,b)=>(a.layer[2]+this.assets.get(a.layer[0]).height)-(b.layer[2]+this.assets.get(b.layer[0]).height));
    layers.push(...characters,...frontLayers);
    if(this.assets.has(0))layers.push({layer:[0,0,0]});
    const picture={id,pic_id:p.id,layers,for_ads:false,visit:false};
    this.validate(picture);
    return picture;
  }
  validate(picture){
    if(!this.pictures.has(picture?.pic_id)||!Array.isArray(picture.layers)||picture.layers.length<1||picture.layers.length>64)throw Error('Invalid generated postcard');
    for(const entry of picture.layers){const tuple=entry?.layer;if(!Array.isArray(tuple)||tuple.length!==3||!this.assets.has(tuple[0])||!tuple.slice(1).every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))throw Error('Invalid generated layer');}
    return true;
  }
  coverage(){
    const rows=[...this.definitions.values()].map(d=>({id:d.picture.id,name:d.picture.name,type:d.picture.type,available:d.available,observed:this.samples.has(d.picture.id),companions:this.companionIds(d),unresolved:[...d.unresolved],
      ...(d.fallbackSources?{fallback_place:d.fallbackPlace,fallback_source:d.fallbackSources.map(source=>({pic_id:source.picture.id,name:source.picture.name,place:source.picture.place,location:source.picture.location,observed:this.samples.has(source.picture.id)}))}:{}),
      layout:d.fallbackSources?'approximate-retired-scene':d.observedOnly?'observed-retired-scene':!this.samples.has(d.picture.id)&&[...d.backs,...d.fronts].some(row=>row.matches.some(a=>a.width!==500||a.height!==350))?'approximate-fragments':'configured-or-observed'}));
    return {total:rows.length,available:rows.filter(x=>x.available).length,observed:rows.filter(x=>x.observed).length,approximateRetired:rows.filter(x=>x.layout==='approximate-retired-scene').length,missingResources:this.missing.map(({id,name})=>({id,name})),rows};
  }
}
module.exports={PostcardGenerator};
