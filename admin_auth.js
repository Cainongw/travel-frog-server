'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
function cookie(req,name){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
class AdminAuth {
  constructor(database,env=process.env){
    this.sql=database.db;this.mode=env.FROG_ADMIN_AUTH||'token';
    if(!['token','oidc'].includes(this.mode))throw Error('Invalid FROG_ADMIN_AUTH');
    this.origin=env.FROG_PUBLIC_URL?new URL(env.FROG_PUBLIC_URL).origin:null;
    this.discoveryUrl=env.FROG_OIDC_DISCOVERY_URL;
    this.clientId=env.FROG_OIDC_CLIENT_ID;this.secret=env.FROG_OIDC_CLIENT_SECRET;
    this.groups=(env.FROG_OIDC_ALLOWED_GROUPS||'travel-frog-admins').split(',').map(x=>x.trim()).filter(Boolean);
    this.subjects=(env.FROG_OIDC_ALLOWED_SUBJECTS||'').split(',').filter(Boolean);
    if(this.mode==='oidc'&&(!this.origin||!this.origin.startsWith('https://')))throw Error('OIDC requires HTTPS FROG_PUBLIC_URL');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_login_states(id TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_sessions(id TEXT PRIMARY KEY, user_json TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  configured(){return !!(this.discoveryUrl&&this.clientId&&this.secret);}
  session(req){const row=this.sql.prepare('SELECT * FROM admin_sessions WHERE id=? AND expires>?').get(hash(cookie(req,'frog_admin')),Date.now());return row?{user:JSON.parse(row.user_json),csrf:row.csrf}:null;}
  authorize(req){const s=this.session(req);if(!s)return false;if(!['GET','HEAD'].includes(req.method))return req.headers.origin===this.origin&&req.headers['x-csrf-token']===s.csrf;return true;}
  setCookie(res,name,value,maxAge){res.setHeader('set-cookie',`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);}
  async config(){
    if(!this.configuration){this.configuration=(async()=>{const oidc=await import('openid-client');const config=await oidc.discovery(new URL(this.discoveryUrl),this.clientId,this.secret,undefined,{execute:[oidc.enableNonRepudiationChecks],timeout:10});return {oidc,config};})().catch(e=>{this.configuration=null;throw e;});}
    return this.configuration;
  }
  async handle(req,res,url,send){
    if(!url.pathname.startsWith('/auth/'))return false;
    res.setHeader('cache-control','no-store');
    if(url.pathname==='/auth/session'&&req.method==='GET'){const s=this.mode==='oidc'?this.session(req):null;send(res,200,{mode:this.mode,configured:this.configured(),authenticated:!!s,user:s?.user,csrf:s?.csrf});return true;}
    if(this.mode!=='oidc'){send(res,404,{error:'OAuth is not enabled'});return true;}
    if(url.pathname==='/auth/logout'&&req.method==='POST'){
      if(!this.authorize(req)){send(res,403,{error:'Invalid session or CSRF token'});return true;}
      this.sql.prepare('DELETE FROM admin_sessions WHERE id=?').run(hash(cookie(req,'frog_admin')));this.setCookie(res,'frog_admin','',0);send(res,200,{ok:true});return true;
    }
    if(!this.configured()){send(res,503,{error:'Authentik 客户端尚未配置，请按部署说明填写客户端 ID 与 Secret。'});return true;}
    try{
      const {oidc,config}=await this.config();
      if(url.pathname==='/auth/login'&&req.method==='GET'){
        const state=random(),verifier=oidc.randomPKCECodeVerifier(),nonce=oidc.randomNonce();
        this.sql.prepare('DELETE FROM admin_login_states WHERE expires<?').run(Date.now());
        this.sql.prepare('DELETE FROM admin_sessions WHERE expires<?').run(Date.now());
        this.sql.prepare('INSERT INTO admin_login_states VALUES (?,?,?,?)').run(hash(state),verifier,nonce,Date.now()+600000);
        this.setCookie(res,'frog_login',state,600);
        const target=oidc.buildAuthorizationUrl(config,{redirect_uri:this.origin+'/auth/callback',scope:'openid profile email',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
        res.writeHead(302,{location:target.href});res.end();return true;
      }
      if(url.pathname==='/auth/callback'&&req.method==='GET'){
        const state=url.searchParams.get('state');
        if(!state||state!==cookie(req,'frog_login'))throw Error('登录状态不匹配，请重新登录');
        const pending=this.sql.prepare('DELETE FROM admin_login_states WHERE id=? AND expires>? RETURNING *').get(hash(state),Date.now());
        if(!pending)throw Error('登录已过期或已使用');
        const tokens=await oidc.authorizationCodeGrant(config,new URL(url.pathname+url.search,this.origin),{pkceCodeVerifier:pending.verifier,expectedState:state,expectedNonce:pending.nonce,idTokenExpected:true});
        const claims=tokens.claims();
        const user=await oidc.fetchUserInfo(config,tokens.access_token,claims.sub);
        const groups=Array.isArray(user.groups)?user.groups:Array.isArray(claims.groups)?claims.groups:[];
        if(!this.subjects.includes(claims.sub)&&!groups.some(x=>this.groups.includes(x))){send(res,403,{error:'此账号没有青蛙邮局管理权限，请加入 travel-frog-admins 用户组。'});return true;}
        const id=random(),csrf=random();
        const identity={sub:claims.sub,name:user.name||user.preferred_username||claims.sub};
        this.sql.prepare('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(hash(id),JSON.stringify(identity),csrf,Date.now()+43200000);
        this.setCookie(res,'frog_admin',id,43200);res.writeHead(302,{location:'/admin/'});res.end();return true;
      }
      send(res,404,{error:'Unknown authentication route'});
    }catch(e){console.error('OAuth login failed:',e.code||e.name);send(res,400,{error:'统一登录失败，请检查 Authentik 客户端、回调地址和用户组，然后重新登录。'});}
    return true;
  }
}
module.exports={AdminAuth};
