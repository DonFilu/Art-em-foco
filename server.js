const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {OAuth2Client}=require('google-auth-library');
const {getDatabase,checkDatabase}=require('./db');
const root=__dirname,port=process.env.PORT||3000,googleClient=new OAuth2Client();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const SESSION_MS=30*24*60*60*1000;
function json(res,status,body,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body))}
async function readJSON(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>12000)throw new Error('Requisição muito grande')}return JSON.parse(data)}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2))}
function cookie(token,maxAge){return 'aef_session='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge}
function safeUser(u){return {id:u.artId,name:u.displayName,picture:u.picture||'',email:u.email||'',username:u.username||u.artId.toLowerCase(),bio:u.bio||'',createdAt:u.createdAt,role:u.role||'artist',socials:u.socials||{}}}
function publicUser(u){return {id:u.artId,username:u.username||u.artId.toLowerCase(),name:u.displayName,bio:u.bio||'',avatar:u.avatar||'',socials:u.socials||{}}}
async function sessionUser(req){const token=cookies(req).aef_session;if(!token||! /^[a-f0-9]{64}$/.test(token))return null;const db=await getDatabase();const session=await db.collection('sessions').findOne({_id:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:{$gt:new Date()}});if(!session)return null;return db.collection('users').findOne({_id:session.userId})}
async function ensureIndexes(db){await Promise.all([db.collection('users').createIndex({googleSub:1},{unique:true}),db.collection('users').createIndex({artId:1},{unique:true}),db.collection('users').createIndex({username:1},{unique:true,sparse:true}),db.collection('friendships').createIndex({pair:1},{unique:true}),db.collection('sessions').createIndex({expiresAt:1},{expireAfterSeconds:0})])}
async function issueSession(db,user,res){const token=crypto.randomBytes(32).toString('hex');await db.collection('sessions').insertOne({_id:crypto.createHash('sha256').update(token).digest('hex'),userId:user._id,createdAt:new Date(),expiresAt:new Date(Date.now()+SESSION_MS)});return json(res,200,{user:safeUser(user)},{'Set-Cookie':cookie(token,SESSION_MS/1000)})}
http.createServer(async(req,res)=>{
let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{return json(res,400,{error:'Requisição inválida'})}
if(pathname==='/api/auth/config'){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});return json(res,200,{clientId:process.env.GOOGLE_CLIENT_ID||null})}
if(pathname==='/api/auth/google'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 if(!process.env.GOOGLE_CLIENT_ID)return json(res,503,{error:'Login Google não configurado'});
 let payload;try{const {credential}=await readJSON(req);if(typeof credential!=='string'||credential.length>10000)return json(res,400,{error:'Credencial inválida'});const ticket=await googleClient.verifyIdToken({idToken:credential,audience:process.env.GOOGLE_CLIENT_ID});payload=ticket.getPayload();if(!payload?.sub||!payload.email_verified)return json(res,401,{error:'Conta não verificada'})}catch{return json(res,401,{error:'Falha ao verificar conta Google'})}
 try{
 const db=await getDatabase();await ensureIndexes(db);const users=db.collection('users');const now=new Date();
 let user=await users.findOne({googleSub:payload.sub});
 if(!user){
   const seq=await db.collection('counters').findOneAndUpdate({_id:'artistId'},{$inc:{value:1}}, {upsert:true,returnDocument:'after'});
   const artId='AEF-'+String(seq.value).padStart(8,'0');
   try{await users.insertOne({googleSub:payload.sub,artId,username:artId.toLowerCase(),displayName:(payload.name||'Artista').slice(0,60),email:payload.email||'',picture:payload.picture||'',bio:'',role:'artist',createdAt:now,updatedAt:now,lastLoginAt:now});}catch(e){if(e.code!==11000)throw e}
   user=await users.findOne({googleSub:payload.sub});
 }else{await users.updateOne({_id:user._id},{$set:{email:payload.email||'',picture:payload.picture||'',lastLoginAt:now}});user=await users.findOne({_id:user._id})}
 return issueSession(db,user,res)
 }catch(e){console.error('Falha ao persistir login:',e.message);return json(res,503,{error:'Não foi possível salvar a conta no banco de dados'})}
}
if(pathname==='/api/auth/me'){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});try{const u=await sessionUser(req);return u?json(res,200,{user:safeUser(u)}):json(res,401,{error:'Sessão não encontrada'})}catch{return json(res,503,{error:'Banco de dados indisponível'})}}
if(pathname==='/api/auth/logout'){if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});try{const token=cookies(req).aef_session;if(token)await (await getDatabase()).collection('sessions').deleteOne({_id:crypto.createHash('sha256').update(token).digest('hex')});return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)})}catch{return json(res,503,{error:'Não foi possível encerrar a sessão'})}}
if(pathname==='/api/profile'){if(req.method!=='PATCH')return json(res,405,{error:'Método não permitido'});try{const user=await sessionUser(req);if(!user)return json(res,401,{error:'Faça login para editar seu perfil'});const data=await readJSON(req);if(typeof data.name!=='string'||typeof data.bio!=='string')return json(res,400,{error:'Dados inválidos'});const name=data.name.trim().slice(0,60),bio=data.bio.trim().slice(0,240),username=String(data.username||user.username||user.artId.toLowerCase()).trim().toLowerCase().replace(/^@/,'');if(!/^[a-z0-9_]{3,24}$/.test(username))return json(res,400,{error:'Usuário inválido: use 3 a 24 letras, números ou _'});const socials={};for(const [key,domain] of Object.entries({tiktok:'tiktok.com',youtube:'youtube.com',instagram:'instagram.com',facebook:'facebook.com'})){const raw=String(data.socials?.[key]||'').trim();if(raw){let url;try{url=new URL(raw)}catch{return json(res,400,{error:'Link inválido de '+key})}const host=url.hostname.toLowerCase();const allowed=key==='youtube'?['youtube.com','youtu.be']:key==='facebook'?['facebook.com','fb.com']: [domain];if(url.protocol!=='https:'||!allowed.some(d=>host===d||host.endsWith('.'+d))||raw.length>300)return json(res,400,{error:'Use um link HTTPS válido de '+key});socials[key]=url.href}}if(name.length<2)return json(res,400,{error:'O nome precisa de pelo menos 2 caracteres'});const db=await getDatabase();await db.collection('users').updateOne({_id:user._id},{$set:{displayName:name,bio,username,socials,updatedAt:new Date()}});return json(res,200,{user:safeUser({...user,displayName:name,bio,username,socials})})}catch(e){return json(res,e.code===11000?409:400,{error:e.code===11000?'Nome de usuário indisponível':'Não foi possível atualizar o perfil'})}}

if(pathname==='/api/community/search'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Entre com Google'});const q=(new URL(req.url,'http://localhost').searchParams.get('q')||'').trim().replace(/^@/,'').toLowerCase();if(q.length<2||q.length>50||!/^[a-z0-9_-]+$/.test(q))return json(res,400,{error:'Pesquisa inválida'});const db=await getDatabase();const artists=await db.collection('users').find({$or:[{username:{$regex:'^'+q}},{artId:{$regex:'^'+q.toUpperCase()}}]}).limit(12).toArray();return json(res,200,{artists:artists.filter(u=>u.artId!==me.artId).map(publicUser)})}catch{return json(res,503,{error:'Não foi possível pesquisar artistas'})}
}

if(pathname==='/api/community/profile'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{
 const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});
 const id=new URL(req.url,'http://localhost').searchParams.get('id')||'';
 if(!/^AEF-\d{8,}$/.test(id))return json(res,400,{error:'ID inválido'});
 const db=await getDatabase(),artist=await db.collection('users').findOne({artId:id});
 if(!artist)return json(res,404,{error:'Artista não encontrado'});
 const relation=await db.collection('friendships').findOne({pair:[me.artId,id].sort().join(':')});
 return json(res,200,{artist:publicUser(artist),friendship:relation?{status:relation.status,direction:relation.requester===me.artId?'sent':'received'}:null});
 }catch{return json(res,503,{error:'Não foi possível abrir o perfil'})}
}
if(pathname==='/api/community/friends'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const db=await getDatabase(),relations=await db.collection('friendships').find({members:me.artId}).limit(200).toArray(),ids=relations.map(r=>r.members.find(id=>id!==me.artId)),users=await db.collection('users').find({artId:{$in:ids}}).toArray(),byId=new Map(users.map(u=>[u.artId,publicUser(u)]));return json(res,200,{friends:relations.map(r=>({artist:byId.get(r.members.find(id=>id!==me.artId)),status:r.status,direction:r.requester===me.artId?'sent':'received'})).filter(r=>r.artist)})}catch{return json(res,503,{error:'Não foi possível carregar amigos'})}
}
if(pathname==='/api/community/friends/request'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const {artistId}=await readJSON(req);if(typeof artistId!=='string'||!/^AEF-\d{8,}$/.test(artistId)||artistId===me.artId)return json(res,400,{error:'Artista inválido'});const db=await getDatabase();if(!await db.collection('users').findOne({artId:artistId}))return json(res,404,{error:'Artista não encontrado'});const members=[me.artId,artistId].sort();await db.collection('friendships').insertOne({pair:members.join(':'),members,requester:me.artId,status:'pending',createdAt:new Date()});return json(res,200,{ok:true})}catch(e){return json(res,e.code===11000?409:503,{error:e.code===11000?'Convite ou amizade já existente':'Não foi possível enviar convite'})}
}
if(pathname==='/api/community/friends/respond'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const {artistId,action}=await readJSON(req);if(!['accept','decline','remove'].includes(action)||typeof artistId!=='string')return json(res,400,{error:'Ação inválida'});const db=await getDatabase(),col=db.collection('friendships'),pair=[me.artId,artistId].sort().join(':'),r=await col.findOne({pair,members:me.artId});if(!r)return json(res,404,{error:'Convite não encontrado'});if(action==='accept'){if(r.status!=='pending'||r.requester===me.artId)return json(res,403,{error:'Ação não permitida'});await col.updateOne({_id:r._id},{$set:{status:'accepted',updatedAt:new Date()}})}else{if(action==='decline'&&(r.status!=='pending'||r.requester===me.artId))return json(res,403,{error:'Ação não permitida'});await col.deleteOne({_id:r._id})}return json(res,200,{ok:true})}catch{return json(res,503,{error:'Não foi possível atualizar amizade'})}
}
if(pathname==='/api/database/status'){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});try{await checkDatabase();return json(res,200,{connected:true})}catch{return json(res,503,{connected:false})}}
if(pathname==='/')pathname='/index.html';
if(['/db.js','/server.js','/package.json','/package-lock.json'].includes(pathname)||pathname.startsWith('/.')){res.writeHead(404);return res.end('Não encontrado')}
const file=path.resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end('Acesso negado')}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500);return res.end('Arquivo indisponível')}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data)})
}).listen(port,'0.0.0.0',()=>console.log('Art em Foco online na porta '+port));
