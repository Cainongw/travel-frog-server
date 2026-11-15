'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),http=require('node:http'),crypto=require('node:crypto');
const {FrogDatabase}=require('./database'),{AdminAuth}=require('./admin_auth');
test('OIDC validates state, nonce, PKCE, signature, group, session, CSRF and logout',async t=>{
 const db=new FrogDatabase(':memory:');t.after(()=>db.close());const client=await import('openid-client');
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
 let nonce='',challenge='',groups=['travel-frog-admins'],issuer;
 const provider=http.createServer(async(req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.url==='/jwks'){res.end(JSON.stringify({keys:[jwk]}));return;}
   if(req.url==='/userinfo'){res.end(JSON.stringify({sub:'user1',name:'Tester',groups}));return;}
   const chunks=[];for await(const b of req)chunks.push(b);const form=new URLSearchParams(Buffer.concat(chunks).toString());
   assert.equal(form.get('client_secret'),'test-secret');assert.equal(await client.calculatePKCECodeChallenge(form.get('code_verifier')),challenge);
   const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');
   const body=Buffer.from(JSON.stringify({iss:issuer,sub:'user1',aud:'frog',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce})).toString('base64url');
   const content=head+'.'+body;const sig=crypto.sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url');
   res.end(JSON.stringify({access_token:'opaque',token_type:'Bearer',id_token:content+'.'+sig}));
 });
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>provider.close());issuer='http://127.0.0.1:'+provider.address().port;
 const auth=new AdminAuth(db,{FROG_ADMIN_AUTH:'oidc',FROG_PUBLIC_URL:'https://frog.example',FROG_OIDC_DISCOVERY_URL:issuer,FROG_OIDC_CLIENT_ID:'frog',FROG_OIDC_CLIENT_SECRET:'test-secret'});
 const config=new client.Configuration({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',userinfo_endpoint:issuer+'/userinfo',jwks_uri:issuer+'/jwks',id_token_signing_alg_values_supported:['RS256']},'frog','test-secret');client.allowInsecureRequests(config);client.enableNonRepudiationChecks(config);auth.configuration=Promise.resolve({oidc:client,config});
 const app=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');if(await auth.handle(req,res,url,(r,s,v)=>{r.writeHead(s,{'Content-Type':'application/json'});r.end(JSON.stringify(v));}))return;res.writeHead(auth.authorize(req)?200:401);res.end();});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.address().port;
 assert.equal((await fetch(base+'/api/admin/status')).status,401);
 const begin=async()=>{const r=await fetch(base+'/auth/login',{redirect:'manual'});assert.equal(r.status,302);const url=new URL(r.headers.get('location'));nonce=url.searchParams.get('nonce');challenge=url.searchParams.get('code_challenge');return {state:url.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};};
 const first=await begin();assert.equal((await fetch(base+'/auth/callback?state=wrong&code=x',{headers:{Cookie:first.cookie}})).status,400);
 const cb=()=>fetch(base+'/auth/callback?state='+first.state+'&code=test',{headers:{Cookie:first.cookie},redirect:'manual'});
 const result=await cb();assert.equal(result.status,302);const session=result.headers.get('set-cookie');assert.match(session,/HttpOnly; Secure; SameSite=Lax/);const cookie=session.split(';')[0];
 assert.equal((await cb()).status,400,'callback can only be used once');
 assert.equal((await fetch(base+'/api/admin/status',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(base+'/api/admin/role',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'}})).status,401);
 const meta=await fetch(base+'/auth/session',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(meta.user.name,'Tester');
 assert.equal((await fetch(base+'/api/admin/role',{method:'POST',headers:{Cookie:cookie,Origin:'https://frog.example','X-CSRF-Token':meta.csrf}})).status,200);
 const reopened=new AdminAuth(db,{FROG_ADMIN_AUTH:'oidc',FROG_PUBLIC_URL:'https://frog.example'});assert.ok(reopened.session({headers:{cookie}}),'session survives service recreation');
 assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://frog.example','X-CSRF-Token':meta.csrf}})).status,200);
 assert.equal((await fetch(base+'/api/admin/status',{headers:{Cookie:cookie}})).status,401);
 groups=[];const denied=await begin();assert.equal((await fetch(base+'/auth/callback?state='+denied.state+'&code=x',{headers:{Cookie:denied.cookie},redirect:'manual'})).status,403);
});
