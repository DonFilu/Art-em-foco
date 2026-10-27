'use strict';

const crypto=require('crypto');
const {promisify}=require('util');

const scrypt=promisify(crypto.scrypt);
const ADMIN_SESSION_MS=4*60*60*1000;
const PASSWORD_WINDOW_MS=15*60*1000;
const PASSWORD_MAX_ATTEMPTS=5;
const PAGE_SIZE=20;
let indexesReady;

function adminCookie(token,maxAge){return 'cidio_gestao_session='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge}
function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex')}
function validGoogleSub(id){return typeof id==='string'&&/^\d{10,30}$/.test(id)}
function credentialVersion(role,googleSub,passwordHash){return crypto.createHash('sha256').update(role+'\0'+googleSub+'\0'+passwordHash).digest('hex')}
function accounts(){
 const ownerId=process.env.GESTAO_ADMIN_GOOGLE_ID,ownerHash=process.env.GESTAO_PASSWORD_HASH;
 const owner=validGoogleSub(ownerId)&&parsePasswordHash(ownerHash)?{role:'owner',googleSub:ownerId,passwordHash:ownerHash,credentialVersion:credentialVersion('owner',ownerId,ownerHash)}:null;
 const moderators=[],seen=new Set(owner?[owner.googleSub]:[]);
 for(const name of Object.keys(process.env)){const match=/^GESTAO_MOD([1-9]\d*)_ID$/.exec(name);if(!match)continue;const googleSub=process.env[name],passwordHash=process.env['GESTAO_MOD'+match[1]+'_PASSWORD_HASH'];if(!validGoogleSub(googleSub)||!parsePasswordHash(passwordHash)||seen.has(googleSub))continue;seen.add(googleSub);moderators.push({role:'moderator',slot:match[1],googleSub,passwordHash,credentialVersion:credentialVersion('moderator',googleSub,passwordHash)})}
 return {owner,moderators};
}
function configuredAdminId(){return accounts().owner?.googleSub||null}
function configured(){return !!accounts().owner}
function accountFor(googleSub){const configuredAccounts=accounts();if(configuredAccounts.owner?.googleSub===googleSub)return configuredAccounts.owner;return configuredAccounts.moderators.find(account=>account.googleSub===googleSub)||null}
function parsePasswordHash(value){
 if(typeof value!=='string')return null;
 const match=/^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{16,256})\$([A-Za-z0-9_-]{20,256})$/.exec(value);
 if(!match)return null;
 const N=Number(match[1]),r=Number(match[2]),p=Number(match[3]);
 if(!Number.isInteger(N)||N<16384||N>262144||(N&(N-1))!==0||!Number.isInteger(r)||r<1||r>32||!Number.isInteger(p)||p<1||p>16)return null;
 try{
  const salt=Buffer.from(match[4],'base64url'),hash=Buffer.from(match[5],'base64url');
  if(salt.length<16||hash.length<32||hash.length>128)return null;
  return {N,r,p,salt,hash};
 }catch{return null}
}
async function verifyPassword(password,encoded=process.env.GESTAO_PASSWORD_HASH){
 const parsed=parsePasswordHash(encoded);
 if(!parsed||typeof password!=='string'||password.length<12||password.length>200)return false;
 try{
  const derived=await scrypt(password,parsed.salt,parsed.hash.length,{N:parsed.N,r:parsed.r,p:parsed.p,maxmem:256*1024*1024});
  return crypto.timingSafeEqual(derived,parsed.hash);
 }catch{return false}
}
function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function parseCursor(value){
 if(!value)return null;
 try{const id=Buffer.from(value,'base64url').toString('utf8');return /^AEF-\d{8,}$/.test(id)?id:null}catch{return null}
}
function cursorFor(artistId){return Buffer.from(artistId).toString('base64url')}
function requestKey(req,user){return crypto.createHash('sha256').update(String(req.socket.remoteAddress||'unknown').slice(0,128)+'\0'+String(user._id)).digest('hex')}
async function canTryPassword(db,req,user){const now=new Date(),row=await db.collection('admin_login_attempts').findOne({_id:requestKey(req,user),resetAt:{$gt:now}},{projection:{count:1}});return !row||row.count<PASSWORD_MAX_ATTEMPTS}
async function failedPassword(db,req,user){const now=new Date(),key=requestKey(req,user),row=await db.collection('admin_login_attempts').findOneAndUpdate({_id:key,resetAt:{$gt:now}},{$inc:{count:1}},{returnDocument:'after'});if(row)return;await db.collection('admin_login_attempts').updateOne({_id:key},{$set:{count:1,resetAt:new Date(now.getTime()+PASSWORD_WINDOW_MS)}},{upsert:true})}
async function clearAttempts(db,req,user){await db.collection('admin_login_attempts').deleteOne({_id:requestKey(req,user)})}
async function ensureIndexes(db){
 if(!indexesReady)indexesReady=Promise.all([
  db.collection('admin_sessions').createIndex({expiresAt:1},{expireAfterSeconds:0}),
  db.collection('admin_sessions').createIndex({userId:1}),
  db.collection('admin_login_attempts').createIndex({resetAt:1},{expireAfterSeconds:0}),
  db.collection('admin_audit').createIndex({at:1},{expireAfterSeconds:31536000}),
  db.collection('art_posts').createIndex({authorId:1})
 ]).catch(error=>{indexesReady=null;throw error});
 return indexesReady;
}
async function normalAndAdmin(req,db,sessionUser){
 if(!configured())return null;
 const user=await sessionUser(req);
 const account=user&&accountFor(user.googleSub);
 if(!user||!account)return null;
 const token=(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('cidio_gestao_session='))?.slice('cidio_gestao_session='.length);
 if(!token||! /^[a-f0-9]{64}$/.test(decodeURIComponent(token)))return null;
 const session=await db.collection('admin_sessions').findOne({_id:hashToken(decodeURIComponent(token)),userId:user._id,googleSub:account.googleSub,role:account.role,credentialVersion:account.credentialVersion,expiresAt:{$gt:new Date()}});
 return session?{user,session,role:account.role,account}:null;
}
function csrfValid(req,admin){
 const token=req.headers['x-gestao-csrf'];
 return typeof token==='string'&&typeof admin.session.csrfToken==='string'&&token.length===admin.session.csrfToken.length&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(admin.session.csrfToken));
}
async function requireAdmin(req,res,db,sessionUser,json,{csrf=false,roles=null}={}){
 const admin=await normalAndAdmin(req,db,sessionUser);
 if(!admin){json(res,401,{error:'Acesso administrativo não autorizado'});return null}
 if(roles&&!roles.includes(admin.role)){json(res,403,{error:'Esta ação exige acesso do proprietário'});return null}
 if(csrf&&!csrfValid(req,admin)){json(res,403,{error:'Solicitação administrativa inválida'});return null}
 return admin;
}
async function issueSession(db,user,account,res,json){
 const token=crypto.randomBytes(32).toString('hex'),csrfToken=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+ADMIN_SESSION_MS);
 await db.collection('admin_sessions').insertOne({_id:hashToken(token),userId:user._id,googleSub:user.googleSub,role:account.role,credentialVersion:account.credentialVersion,csrfToken,createdAt:new Date(),expiresAt});
 json(res,200,{ok:true,role:account.role,csrfToken,expiresAt:expiresAt.toISOString()},{'Set-Cookie':adminCookie(token,ADMIN_SESSION_MS/1000),'X-Frame-Options':'DENY'});
}
function noStoreHeaders(){return {'Cache-Control':'no-store, private, max-age=0','Pragma':'no-cache','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'"}}
async function route(req,res,pathname,{sessionUser,getDatabase,json,readJSON}){
 if(!pathname.startsWith('/api/gestao'))return false;
 try{
  if(pathname==='/api/gestao/session'){
   if(req.method!=='GET')return json(res,405,{error:'Método não permitido'}),true;
   if(!configured())return json(res,403,{error:'Acesso administrativo indisponível'},noStoreHeaders()),true;
   const db=await getDatabase(),user=await sessionUser(req),account=user&&accountFor(user.googleSub),googleAuthorized=!!account;
   const admin=googleAuthorized?await normalAndAdmin(req,db,sessionUser):null;
   return json(res,200,{googleAuthorized,admin:!!admin,role:admin?.role||account?.role||null,csrfToken:admin?.session.csrfToken||null,expiresAt:admin?.session.expiresAt?.toISOString()||null},noStoreHeaders()),true;
  }
  if(!configured())return json(res,403,{error:'Acesso administrativo indisponível'},noStoreHeaders()),true;
  const db=await getDatabase();await ensureIndexes(db);
  if(pathname==='/api/gestao/login'){
   if(req.method!=='POST')return json(res,405,{error:'Método não permitido'}),true;
   const user=await sessionUser(req);
   const account=user&&accountFor(user.googleSub);if(!user||!account)return json(res,403,{error:'Acesso administrativo não autorizado'},noStoreHeaders()),true;
   if(!await canTryPassword(db,req,user))return json(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'},noStoreHeaders()),true;
   const body=await readJSON(req);
   if(!await verifyPassword(body?.password,account.passwordHash)){await failedPassword(db,req,user);return json(res,401,{error:'Credencial administrativa inválida'},noStoreHeaders()),true}
   await clearAttempts(db,req,user);await issueSession(db,user,account,res,json);return true;
  }
  if(pathname==='/api/gestao/logout'){
   if(req.method!=='POST')return json(res,405,{error:'Método não permitido'}),true;
   const admin=await requireAdmin(req,res,db,sessionUser,json,{csrf:true});if(!admin)return true;
   await db.collection('admin_sessions').deleteOne({_id:admin.session._id});
   return json(res,200,{ok:true},{...noStoreHeaders(),'Set-Cookie':adminCookie('',0)}),true;
  }
  if(pathname==='/api/gestao/reports'){
   if(req.method!=='GET')return json(res,405,{error:'Método não permitido'}),true;
   if(!await requireAdmin(req,res,db,sessionUser,json,{roles:['owner']}))return true;
   const [users,posts,likes]=await Promise.all([db.collection('users').countDocuments(),db.collection('art_posts').countDocuments(),db.collection('post_likes').countDocuments()]);
   return json(res,200,{totals:{users,posts,likes}},noStoreHeaders()),true;
  }
  if(pathname==='/api/gestao/users'){
   if(req.method!=='GET')return json(res,405,{error:'Método não permitido'}),true;
   if(!await requireAdmin(req,res,db,sessionUser,json,{roles:['owner']}))return true;
   const params=new URL(req.url,'http://localhost').searchParams,q=(params.get('q')||'').trim().slice(0,50),cursor=parseCursor(params.get('cursor')||'');
   const query={};
   if(q){const regex=new RegExp(escapeRegex(q),'i');query.$or=[{artId:regex},{username:regex},{displayName:regex}]}
   if(cursor)query.artId={...(query.artId||{}),$gt:cursor};
   const rows=await db.collection('users').aggregate([
    {$match:query},{$sort:{artId:1,_id:1}},{$limit:PAGE_SIZE+1},
    {$lookup:{from:'art_posts',let:{artist:'$artId'},pipeline:[{$match:{$expr:{$eq:['$authorId','$$artist']}}},{$group:{_id:null,posts:{$sum:1},likes:{$sum:{$ifNull:['$likeCount',0]}}}}],as:'metrics'}},
    {$project:{_id:0,artId:1,displayName:1,username:1,metrics:1}}
   ]).toArray();
   const hasMore=rows.length>PAGE_SIZE,users=rows.slice(0,PAGE_SIZE).map(row=>({id:row.artId,name:row.displayName||row.username||row.artId,username:row.username||'',posts:row.metrics[0]?.posts||0,likesReceived:row.metrics[0]?.likes||0}));
   return json(res,200,{users,nextCursor:hasMore?cursorFor(users.at(-1).id):null},noStoreHeaders()),true;
  }
  const emailMatch=/^\/api\/gestao\/users\/(AEF-\d{8,})\/email$/.exec(pathname);
  if(emailMatch){
   if(req.method!=='POST')return json(res,405,{error:'Método não permitido'}),true;
   const admin=await requireAdmin(req,res,db,sessionUser,json,{csrf:true,roles:['owner']});if(!admin)return true;
   if(!await canTryPassword(db,req,admin.user))return json(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'},noStoreHeaders()),true;
   const body=await readJSON(req);
   if(!await verifyPassword(body?.password,admin.account.passwordHash)){await failedPassword(db,req,admin.user);return json(res,401,{error:'Credencial administrativa inválida'},noStoreHeaders()),true}
   const target=await db.collection('users').findOne({artId:emailMatch[1]},{projection:{email:1}});
   if(!target)return json(res,404,{error:'Artista não encontrado'},noStoreHeaders()),true;
   await db.collection('admin_audit').insertOne({type:'email_reveal',adminUserId:admin.user._id,adminRole:admin.role,targetArtistId:emailMatch[1],at:new Date()});
   await clearAttempts(db,req,admin.user);
   return json(res,200,{email:target.email||''},noStoreHeaders()),true;
  }
  return json(res,404,{error:'Rota administrativa não encontrada'},noStoreHeaders()),true;
 }catch(error){
  console.error('Falha no Gestão:',error.message);
  return json(res,503,{error:'Não foi possível concluir a operação administrativa'},noStoreHeaders()),true;
 }
}

module.exports={route,parsePasswordHash,verifyPassword,configured,requireAdmin,accounts,accountFor,credentialVersion,normalAndAdmin};
