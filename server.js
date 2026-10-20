const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {OAuth2Client}=require('google-auth-library');
const {getDatabase,checkDatabase}=require('./db');
const root=__dirname,port=process.env.PORT||3000,googleClient=new OAuth2Client();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
const SESSION_MS=30*24*60*60*1000;

const {ObjectId}=require('mongodb');
const notifications=require('./modules/notifications');
const interactions=require('./modules/interactions');
const stories=require('./modules/stories');
const ranking=require('./modules/ranking');
const badges=require('./modules/badges');
const {avatarInfo}=require('./modules/avatars');
const ART_MAX=5*1024*1024;
async function readArt(req){
 const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>7*1024*1024)throw Error('Arquivo muito grande');chunks.push(part)}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(typeof data.description!=='string'||data.description.length>1000||!['public','friends'].includes(data.visibility)||typeof data.image!=='string')throw Error('Dados de publicação inválidos');
 const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data.image);
 if(!match)throw Error('Formato de imagem inválido');
 const buffer=Buffer.from(match[2],'base64'),mime=match[1];
 if(!buffer.length||buffer.length>ART_MAX)throw Error('Arquivo muito grande (máximo 5 MB)');
 const valid=mime==='image/png'?buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:mime==='image/webp'?buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP':buffer.toString('ascii',0,3)==='GIF';
 if(!valid)throw Error('Arquivo de imagem inválido');
 return {buffer,mime,referenceUsed:data.referenceUsed===true,description:data.description.trim(),visibility:data.visibility,extension:mime.split('/')[1].replace('jpeg','jpg')};
}
async function uploadPrivateArt(art,user){
 const key=process.env.IMAGEKIT_PRIVATE_KEY;if(!key)throw Error('ImageKit não configurado');
 const form=new FormData();form.append('file',new Blob([art.buffer],{type:art.mime}),'art.'+art.extension);
 form.append('fileName',crypto.randomUUID()+'.'+art.extension);
 form.append('folder','/art-em-foco/publicacoes/'+user.artId+'/');
 form.append('useUniqueFileName','true');form.append('isPrivateFile','true');
 const response=await fetch('https://upload.imagekit.io/api/v1/files/upload',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},body:form,signal:AbortSignal.timeout(30000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.fileId||!result.url)throw Error('Falha no armazenamento da publicação ('+response.status+')');
 return {fileId:result.fileId,url:result.url};
}
async function canViewArt(db,post,user){
 if(post.visibility==='public'||user?.artId===post.authorId)return true;
 if(!user)return false;
 return !!await db.collection('friendships').findOne({pair:[user.artId,post.authorId].sort().join(':'),status:'accepted'});
}
function privateArtURL(url,feed=false){
 const key=process.env.IMAGEKIT_PRIVATE_KEY;if(!key)throw Error('ImageKit não configurado');
 const u=new URL(url);if(u.protocol!=='https:')throw Error('URL inválida');
 if(feed){const parts=u.pathname.split('/').filter(Boolean);const offset=u.hostname==='ik.imagekit.io'?1:0;parts.splice(offset,0,'tr:w-1080,q-85');u.pathname='/'+parts.join('/');}
 const expiry=Math.floor(Date.now()/1000)+45;
 u.searchParams.set('ik-t',String(expiry));
 const parts=u.pathname.split('/').filter(Boolean);const signedPath=u.hostname==='ik.imagekit.io'&&parts.length>1?'/'+parts.slice(1).join('/') :u.pathname;const signature=crypto.createHmac('sha1',key).update(signedPath.replace(/^\//,'')+expiry).digest('hex');
 u.searchParams.set('ik-s',signature);
 return u.toString();
}

function json(res,status,body,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body))}
async function readJSON(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>12000)throw new Error('Requisição muito grande')}return JSON.parse(data)}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2))}
function cookie(token,maxAge){return 'aef_session='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge}
function safeUser(u){const resolved=avatarInfo(u);return {id:u.artId,name:u.displayName,picture:u.picture||'',email:u.email||'',username:u.username||u.artId.toLowerCase(),bio:u.bio||'',createdAt:u.createdAt,role:u.role||'artist',socials:u.socials||{},avatar:u.avatar||'',cover:u.cover||'',avatarUrl:resolved.avatar,avatarFallback:resolved.avatarFallback,avatarVersion:resolved.avatarVersion}}
function publicUser(u){return {id:u.artId,username:u.username||u.artId.toLowerCase(),name:u.displayName,bio:u.bio||'',cover:u.cover||'',socials:u.socials||{},...avatarInfo(u)}}
async function postViews(db,posts,user,artists=new Map()){
 const ids=posts.map(post=>post._id);let liked=new Set();
 if(user&&ids.length){const rows=await db.collection('post_likes').find({userId:user._id,postId:{$in:ids}},{projection:{postId:1}}).toArray();liked=new Set(rows.map(row=>String(row.postId)))}
 return posts.map(post=>({id:post._id.toString(),authorId:post.authorId,artist:artists.get(post.authorId)||null,description:post.description,visibility:post.visibility,referenceUsed:post.referenceUsed===true,createdAt:post.createdAt,image:'/api/art/media/'+post._id.toString()+'?size=feed',imageFull:'/api/art/media/'+post._id.toString(),likeCount:post.likeCount||0,commentCount:post.commentCount||0,likedByViewer:liked.has(String(post._id))}));
}

async function readImageUpload(req){
 let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>7*1024*1024)throw Error('Imagem muito grande (máximo 5 MB)');chunks.push(chunk)}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!['avatar','cover'].includes(data.type)||typeof data.image!=='string')throw Error('Imagem inválida');
 const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data.image);
 if(!match)throw Error('Envie uma imagem PNG, JPG, WEBP ou GIF');
 const buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>5*1024*1024)throw Error('Imagem muito grande (máximo 5 MB)');
 const magic=match[1]==='image/png'?buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='image/jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:match[1]==='image/webp'?buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP':buffer.toString('ascii',0,3)==='GIF';
 if(!magic)throw Error('Formato de imagem inválido');
 return {type:data.type,buffer,mime:match[1],extension:match[1].split('/')[1].replace('jpeg','jpg')};
}
async function discordImageUpload(image,user){
 const token=process.env.DISCORD_BOT_TOKEN;
 const channel=image.type==='avatar'?process.env.DISCORD_AVATARS_CHANNEL_ID:process.env.DISCORD_COVERS_CHANNEL_ID;
 if(!token||!channel||!/^\d{16,22}$/.test(channel))throw Error('Armazenamento Discord não configurado');
 const form=new FormData();form.append('payload_json',JSON.stringify({content:'Art em Foco | '+image.type+' | '+user.artId,allowed_mentions:{parse:[]}}));
 form.append('files[0]',new Blob([image.buffer],{type:image.mime}),user.artId+'-'+Date.now()+'.'+image.extension);
 const response=await fetch('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:form,signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>({}));if(!response.ok||!data.id||!data.attachments?.[0]?.id)throw Error('Falha no envio ao Discord ('+response.status+')');
 return {channelId:channel,messageId:data.id,attachmentId:data.attachments[0].id,mime:image.mime};
}
async function discordImageBytes(ref){
 const token=process.env.DISCORD_BOT_TOKEN;
 if(!token||!ref?.channelId||!ref?.messageId||!ref?.attachmentId)return null;
 const response=await fetch('https://discord.com/api/v10/channels/'+ref.channelId+'/messages/'+ref.messageId,{headers:{Authorization:'Bot '+token},signal:AbortSignal.timeout(12000)});
 if(!response.ok)return null;const data=await response.json();const attachment=data.attachments?.find(a=>a.id===ref.attachmentId);
 if(!attachment?.url)return null;
 const image=await fetch(attachment.url,{signal:AbortSignal.timeout(12000)});
 if(!image.ok)return null;const bytes=Buffer.from(await image.arrayBuffer());if(bytes.length>6*1024*1024)return null;
 return {bytes,mime:ref.mime||'image/png'};
}

async function sessionUser(req){const token=cookies(req).aef_session;if(!token||! /^[a-f0-9]{64}$/.test(token))return null;const db=await getDatabase();const session=await db.collection('sessions').findOne({_id:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:{$gt:new Date()}});if(!session)return null;return db.collection('users').findOne({_id:session.userId})}
async function ensureIndexes(db){await Promise.all([db.collection('users').createIndex({googleSub:1},{unique:true}),db.collection('users').createIndex({artId:1},{unique:true}),db.collection('users').createIndex({username:1},{unique:true,sparse:true}),db.collection('friendships').createIndex({pair:1},{unique:true}),db.collection('sessions').createIndex({expiresAt:1},{expireAfterSeconds:0}),db.collection('notifications').createIndex({userId:1,type:1},{unique:true}),db.collection('post_likes').createIndex({postId:1,userId:1},{unique:true}),db.collection('post_likes').createIndex({userId:1,postId:1}),db.collection('art_comments').createIndex({postId:1,parentId:1,_id:-1}),db.collection('comment_likes').createIndex({commentId:1,userId:1},{unique:true}),db.collection('comment_likes').createIndex({userId:1,commentId:1})])}
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
   if(user)await notifications.welcome(db,user._id);
 }else{await users.updateOne({_id:user._id},{$set:{email:payload.email||'',picture:payload.picture||'',lastLoginAt:now}});user=await users.findOne({_id:user._id})}
 return issueSession(db,user,res)
 }catch(e){console.error('Falha ao persistir login:',e.message);return json(res,503,{error:'Não foi possível salvar a conta no banco de dados'})}
}
if(await notifications.route(req,res,pathname,{sessionUser,getDatabase,json}))return;
if(await interactions.route(req,res,pathname,{sessionUser,getDatabase,json,canViewArt,notifications,ensureIndexes}))return;
if(await stories.route(req,res,pathname,{sessionUser,getDatabase,json}))return;
if(await ranking.route(req,res,pathname,{sessionUser,getDatabase,json}))return;
if(await badges.route(req,res,pathname,{sessionUser,getDatabase,json}))return;
if(pathname==='/api/auth/me'){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});try{const u=await sessionUser(req);return u?json(res,200,{user:safeUser(u)}):json(res,401,{error:'Sessão não encontrada'})}catch{return json(res,503,{error:'Banco de dados indisponível'})}}
if(pathname==='/api/auth/logout'){if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});try{const token=cookies(req).aef_session;if(token)await (await getDatabase()).collection('sessions').deleteOne({_id:crypto.createHash('sha256').update(token).digest('hex')});return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)})}catch{return json(res,503,{error:'Não foi possível encerrar a sessão'})}}

if(pathname==='/api/settings/notifications'){
 if(!['GET','PATCH'].includes(req.method))return json(res,405,{error:'Método não permitido'});
 try{
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Faça login para acessar configurações'});
  const soundEnabled=user.notificationSettings?.soundEnabled!==false;
  if(req.method==='GET')return json(res,200,{soundEnabled});
  const data=await readJSON(req);
  if(!data||Array.isArray(data)||Object.keys(data).length!==1||!Object.prototype.hasOwnProperty.call(data,'soundEnabled')||typeof data.soundEnabled!=='boolean')return json(res,400,{error:'Configuração inválida'});
  await (await getDatabase()).collection('users').updateOne({_id:user._id},{$set:{'notificationSettings.soundEnabled':data.soundEnabled,updatedAt:new Date()}});
  return json(res,200,{soundEnabled:data.soundEnabled});
 }catch(e){console.error('Erro nas configurações de notificação:',e.message);return json(res,503,{error:'Não foi possível salvar as configurações'})}
}

if(pathname==='/api/profile/image/upload'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Faça login para enviar imagens'});
  const image=await readImageUpload(req),ref=await discordImageUpload(image,user),db=await getDatabase();
  const field=image.type==='avatar'?'avatar':'cover';
  const now=new Date();await db.collection('users').updateOne({_id:user._id},{$set:{[field+'Discord']:ref,[field]:'/api/profile/image/'+encodeURIComponent(user.artId)+'/'+field,[field+'UpdatedAt']:now,updatedAt:now}});
  const updated=await db.collection('users').findOne({_id:user._id});
  return json(res,200,{user:safeUser(updated)});
 }catch(e){console.error('Falha no upload de imagem:',e.message);return json(res,/inválid|grande|Envie/.test(e.message)?400:503,{error:e.message||'Falha ao enviar imagem'})}
}
if(pathname.startsWith('/api/profile/image/')){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 const match=/^\/api\/profile\/image\/(AEF-\d{8,})\/(avatar|cover)$/.exec(pathname);
 if(!match)return json(res,404,{error:'Imagem não encontrada'});
 try{
  const db=await getDatabase(),user=await db.collection('users').findOne({artId:match[1]});
  if(!user)return json(res,404,{error:'Imagem não encontrada'});
  const ref=user[match[2]+'Discord'];const file=await discordImageBytes(ref);
  if(!file)return json(res,404,{error:'Imagem indisponível'});
  res.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.bytes.length,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});return res.end(file.bytes);
 }catch{return json(res,503,{error:'Não foi possível carregar a imagem'})}
}

if(pathname==='/api/profile'){if(req.method!=='PATCH')return json(res,405,{error:'Método não permitido'});try{const user=await sessionUser(req);if(!user)return json(res,401,{error:'Faça login para editar seu perfil'});const data=await readJSON(req);if(typeof data.name!=='string'||typeof data.bio!=='string')return json(res,400,{error:'Dados inválidos'});const name=data.name.trim().slice(0,60),bio=data.bio.trim().slice(0,240),username=String(data.username||user.username||user.artId.toLowerCase()).trim().toLowerCase().replace(/^@/,'');if(!/^[a-z0-9_]{3,24}$/.test(username))return json(res,400,{error:'Usuário inválido: use 3 a 24 letras, números ou _'});const socials={};for(const [key,domain] of Object.entries({tiktok:'tiktok.com',youtube:'youtube.com',instagram:'instagram.com',facebook:'facebook.com'})){const raw=String(data.socials?.[key]||'').trim();if(raw){let url;try{url=new URL(raw)}catch{return json(res,400,{error:'Link inválido de '+key})}const host=url.hostname.toLowerCase();const allowed=key==='youtube'?['youtube.com','youtu.be']:key==='facebook'?['facebook.com','fb.com']: [domain];if(url.protocol!=='https:'||!allowed.some(d=>host===d||host.endsWith('.'+d))||raw.length>300)return json(res,400,{error:'Use um link HTTPS válido de '+key});socials[key]=url.href}}let avatar=user.avatar||'',cover=user.cover||'';for(const key of ['avatar','cover']){if(Object.prototype.hasOwnProperty.call(data,key)){const value=data[key];if(typeof value!=='string'||value.length>1000)return json(res,400,{error:'Link de imagem inválido'});const raw=value.trim();if(raw){let url;try{url=new URL(raw)}catch{return json(res,400,{error:'Link de imagem inválido'})}if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.')||url.hostname==='localhost')return json(res,400,{error:'Use uma URL pública HTTPS para a imagem'});if(key==='avatar')avatar=url.href;else cover=url.href}else if(key==='avatar')avatar='';else cover=''}}if(name.length<2)return json(res,400,{error:'O nome precisa de pelo menos 2 caracteres'});const db=await getDatabase(),now=new Date(),unset={};if(Object.prototype.hasOwnProperty.call(data,'avatar')&&!avatar)unset.avatarDiscord='';if(Object.prototype.hasOwnProperty.call(data,'cover')&&!cover)unset.coverDiscord='';await db.collection('users').updateOne({_id:user._id},{$set:{displayName:name,bio,username,socials,avatar,cover,avatarUpdatedAt:Object.prototype.hasOwnProperty.call(data,'avatar')?now:user.avatarUpdatedAt||null,updatedAt:now},...(Object.keys(unset).length?{$unset:unset}:{})});return json(res,200,{user:safeUser({...user,displayName:name,bio,username,socials,avatar,cover,avatarUpdatedAt:Object.prototype.hasOwnProperty.call(data,'avatar')?now:user.avatarUpdatedAt})})}catch(e){return json(res,e.code===11000?409:400,{error:e.code===11000?'Nome de usuário indisponível':'Não foi possível atualizar o perfil'})}}

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
 const friendsCount=await db.collection('friendships').countDocuments({members:id,status:'accepted'});
 return json(res,200,{artist:publicUser(artist),friendsCount,canViewFriends:me.artId===id||relation?.status==='accepted',friendship:relation?{status:relation.status,direction:relation.requester===me.artId?'sent':'received'}:null});
 }catch{return json(res,503,{error:'Não foi possível abrir o perfil'})}
}
if(pathname==='/api/community/profile/friends'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{
  const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});
  const id=new URL(req.url,'http://localhost').searchParams.get('id')||'';
  if(!/^AEF-\d{8,}$/.test(id))return json(res,400,{error:'ID inválido'});
  const db=await getDatabase();
  const artist=await db.collection('users').findOne({artId:id});
  if(!artist)return json(res,404,{error:'Artista não encontrado'});
  if(me.artId!==id){
   const relation=await db.collection('friendships').findOne({pair:[me.artId,id].sort().join(':'),status:'accepted'});
   if(!relation)return json(res,403,{error:'A lista de amigos é privada'});
  }
  const relations=await db.collection('friendships').find({members:id,status:'accepted'}).limit(200).toArray();
  const ids=relations.map(r=>r.members.find(member=>member!==id));
  const friends=await db.collection('users').find({artId:{$in:ids}}).toArray();
  return json(res,200,{friends:friends.map(publicUser)});
 }catch(e){console.error('Falha ao consultar amigos do artista:',e.message);return json(res,503,{error:'Não foi possível carregar a lista de amigos'})}
}
if(pathname==='/api/community/friends'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const db=await getDatabase(),relations=await db.collection('friendships').find({members:me.artId}).limit(200).toArray(),ids=relations.map(r=>r.members.find(id=>id!==me.artId)),users=await db.collection('users').find({artId:{$in:ids}}).toArray(),byId=new Map(users.map(u=>[u.artId,publicUser(u)]));return json(res,200,{friends:relations.map(r=>({artist:byId.get(r.members.find(id=>id!==me.artId)),status:r.status,direction:r.requester===me.artId?'sent':'received'})).filter(r=>r.artist)})}catch{return json(res,503,{error:'Não foi possível carregar amigos'})}
}
if(pathname==='/api/community/friends/request'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const {artistId}=await readJSON(req);if(typeof artistId!=='string'||!/^AEF-\d{8,}$/.test(artistId)||artistId===me.artId)return json(res,400,{error:'Artista inválido'});const db=await getDatabase(),recipient=await db.collection('users').findOne({artId:artistId});if(!recipient)return json(res,404,{error:'Artista não encontrado'});const members=[me.artId,artistId].sort();await db.collection('friendships').insertOne({pair:members.join(':'),members,requester:me.artId,status:'pending',createdAt:new Date()});try{await notifications.friendRequest(db,me,recipient)}catch(e){console.error('Falha ao notificar pedido de amizade:',e.message)}return json(res,200,{ok:true})}catch(e){return json(res,e.code===11000?409:503,{error:e.code===11000?'Convite ou amizade já existente':'Não foi possível enviar convite'})}
}
if(pathname==='/api/community/friends/respond'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{const me=await sessionUser(req);if(!me)return json(res,401,{error:'Faça login'});const {artistId,action}=await readJSON(req);if(!['accept','decline','remove'].includes(action)||typeof artistId!=='string')return json(res,400,{error:'Ação inválida'});const db=await getDatabase(),col=db.collection('friendships'),pair=[me.artId,artistId].sort().join(':'),r=await col.findOne({pair,members:me.artId});if(!r)return json(res,404,{error:'Convite não encontrado'});if(action==='accept'){if(r.status!=='pending'||r.requester===me.artId)return json(res,403,{error:'Ação não permitida'});await col.updateOne({_id:r._id},{$set:{status:'accepted',updatedAt:new Date()}});try{await notifications.friendResponse(db,me._id,artistId,'accept');const requester=await db.collection('users').findOne({artId:artistId});if(requester)await notifications.friendAccepted(db,requester,me)}catch(e){console.error('Falha ao notificar aceite de amizade:',e.message)}}else{if(action==='decline'&&(r.status!=='pending'||r.requester===me.artId))return json(res,403,{error:'Ação não permitida'});await col.deleteOne({_id:r._id});if(action==='decline')try{await notifications.friendResponse(db,me._id,artistId,'decline')}catch(e){console.error('Falha ao atualizar notificação:',e.message)}}return json(res,200,{ok:true})}catch{return json(res,503,{error:'Não foi possível atualizar amizade'})}
}

if(pathname==='/api/art/publish'){
 if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
 try{
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Entre com Google para publicar'});
  const db=await getDatabase();
  const recent=await db.collection('art_posts').countDocuments({authorId:user.artId,createdAt:{$gte:new Date(Date.now()-3600000)}});
  if(recent>=10)return json(res,429,{error:'Limite de 10 publicações por hora'});
  const art=await readArt(req),uploaded=await uploadPrivateArt(art,user);
  const result=await db.collection('art_posts').insertOne({authorId:user.artId,description:art.description,visibility:art.visibility,referenceUsed:art.referenceUsed,mime:art.mime,fileId:uploaded.fileId,fileURL:uploaded.url,likeCount:0,commentCount:0,createdAt:new Date()});
  return json(res,201,{ok:true,id:result.insertedId.toString()});
 }catch(e){console.error('Falha ao publicar arte:',e.message);return json(res,/inválid|grande|limite/i.test(e.message)?400:503,{error:e.message||'Falha ao publicar'})}
}
if(pathname.startsWith('/api/art/posts/')&&req.method==='DELETE'){
 const id=pathname.slice('/api/art/posts/'.length);
 if(!/^[a-f0-9]{24}$/.test(id))return json(res,400,{error:'Publicação inválida'});
 let releaseDeletion=null;
 try{
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Entre na sua conta para excluir publicações'});
  const db=await getDatabase(),collection=db.collection('art_posts');
  const post=await collection.findOne({_id:new ObjectId(id)});
  if(!post)return json(res,404,{error:'Publicação não encontrada'});
  if(post.authorId!==user.artId)return json(res,403,{error:'Somente o criador pode excluir esta publicação'});
  const locked=await collection.updateOne({_id:post._id,authorId:user.artId,deletingAt:{$exists:false}},{$set:{deletingAt:new Date()}});
  if(!locked.modifiedCount)return json(res,409,{error:'Esta publicação já está sendo excluída'});
  const unlock=()=>collection.updateOne({_id:post._id,authorId:user.artId},{$unset:{deletingAt:''}}).catch(()=>{});
  releaseDeletion=unlock;
  if(!post.fileId){await unlock();return json(res,409,{error:'Arquivo da publicação sem identificação no ImageKit. Exclusão interrompida para evitar inconsistências.'})}
  const key=process.env.IMAGEKIT_PRIVATE_KEY;if(!key){await unlock();return json(res,503,{error:'ImageKit não configurado'})}
  const response=await fetch('https://api.imagekit.io/v1/files/'+encodeURIComponent(post.fileId),{method:'DELETE',headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},signal:AbortSignal.timeout(20000)});
  if(!response.ok&&response.status!==404){await unlock();console.error('Falha ao excluir arquivo no ImageKit:',response.status);return json(res,502,{error:'Não foi possível excluir a imagem no ImageKit. A publicação foi mantida.'})}
  try{const likesReceived=await db.collection('post_likes').countDocuments({postId:post._id});await db.collection('deleted_post_likes').updateOne({_id:post._id},{$setOnInsert:{authorId:post.authorId,likesReceived,deletedAt:new Date()},$set:{visibility:post.visibility}},{upsert:true})}catch(e){await unlock();console.error('Falha ao preservar histórico de curtidas:',e.message);return json(res,503,{error:'Imagem removida, mas o histórico de curtidas não pôde ser salvo. Tente excluir novamente.'})}
  try{await interactions.cleanupPost(db,post._id)}catch(e){await unlock();console.error('Falha ao limpar interações da publicação:',e.message);return json(res,503,{error:'Imagem removida, mas as interações ainda não puderam ser limpas. Tente excluir novamente.'})}
  const result=await collection.deleteOne({_id:post._id,authorId:user.artId});
  if(!result.deletedCount){await unlock();return json(res,503,{error:'Imagem e interações removidas, mas não foi possível remover o registro. Tente novamente.'})}
  releaseDeletion=null;
  return json(res,200,{ok:true});
 }catch(e){await releaseDeletion?.();console.error('Falha ao excluir publicação:',e.message);return json(res,503,{error:'Falha ao excluir publicação. Tente novamente.'})}
}
if(pathname==='/api/art/feed'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{
  const user=await sessionUser(req),db=await getDatabase(),params=new URL(req.url,'http://localhost').searchParams;
  const filter=params.get('filter')==='friends'?'friends':'all';
  const relations=user?await db.collection('friendships').find({members:user.artId,status:'accepted'}).limit(500).toArray():[];
  const friendIds=relations.map(r=>r.members.find(id=>id!==user.artId));
  const query=filter==='friends'?{authorId:{$in:friendIds}}:{$or:[{visibility:'public'},...(user?[{authorId:{$in:[...friendIds,user.artId]},visibility:'friends'},{authorId:user.artId}]:[])]};
  const posts=await db.collection('art_posts').find(query).sort({createdAt:-1}).limit(60).toArray();
  const users=await db.collection('users').find({artId:{$in:[...new Set(posts.map(p=>p.authorId))]}}).toArray();
  const artists=new Map(users.map(u=>[u.artId,publicUser(u)]));
  return json(res,200,{posts:await postViews(db,posts,user,artists)});
 }catch(e){console.error('Falha ao carregar feed:',e.message);return json(res,503,{error:'Não foi possível carregar o feed'})}
}
if(pathname==='/api/art/posts'){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 try{
  const user=await sessionUser(req),db=await getDatabase(),params=new URL(req.url,'http://localhost').searchParams;
  const author=params.get('author')||user?.artId||'';
  if(!/^AEF-\d{8,}$/.test(author))return json(res,400,{error:'Artista inválido'});
  const posts=await db.collection('art_posts').find({authorId:author}).sort({createdAt:-1}).limit(50).toArray();
  const allowed=[];for(const post of posts){if(await canViewArt(db,post,user))allowed.push(post)}
  return json(res,200,{posts:await postViews(db,allowed,user)});
 }catch{return json(res,503,{error:'Não foi possível carregar publicações'})}
}
if(pathname.startsWith('/api/art/media/')){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 const id=pathname.slice('/api/art/media/'.length);if(!/^[a-f0-9]{24}$/.test(id))return json(res,404,{error:'Imagem não encontrada'});
 try{
  const db=await getDatabase(),post=await db.collection('art_posts').findOne({_id:new ObjectId(id)});
  if(!post)return json(res,404,{error:'Imagem não encontrada'});
  const user=await sessionUser(req);if(!await canViewArt(db,post,user))return json(res,403,{error:'Acesso restrito'});
  const feed=new URL(req.url,'http://localhost').searchParams.get('size')==='feed';
  const upstream=await fetch(privateArtURL(post.fileURL,feed),{signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!upstream.ok){console.error('ImageKit recusou imagem privada:',upstream.status);return json(res,502,{error:'Imagem indisponível'});}
  const bytes=Buffer.from(await upstream.arrayBuffer());if(bytes.length>ART_MAX+1024)return json(res,502,{error:'Arquivo inválido'});
  res.writeHead(200,{'Content-Type':post.mime,'Content-Length':bytes.length,'Cache-Control':post.visibility==='public'?'private, max-age=120, must-revalidate':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin','X-Frame-Options':'DENY'});
  return res.end(bytes);
 }catch(e){console.error('Falha ao abrir arte:',e.message);return json(res,503,{error:'Não foi possível abrir a arte'})}
}

if(pathname==='/api/database/status'){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});try{await checkDatabase();return json(res,200,{connected:true})}catch{return json(res,503,{connected:false})}}
if(pathname==='/')pathname='/index.html';
if(pathname==='/politica-de-privacidade'||pathname==='/política-de-privacidade')pathname='/politica-de-privacidade.html';
if(pathname==='/termos-de-uso')pathname='/termos-de-uso.html';
if(pathname==='/configuracoes'||pathname==='/configurações')pathname='/configuracoes.html';
if(pathname==='/ranking')pathname='/ranking.html';
if(['/db.js','/server.js','/package.json','/package-lock.json'].includes(pathname)||pathname.startsWith('/.')){res.writeHead(404);return res.end('Não encontrado')}
const file=path.resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end('Acesso negado')}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500);return res.end('Arquivo indisponível')}const type=mime[path.extname(file)]||'application/octet-stream';if(type.startsWith('text/html'))data=Buffer.from(data.toString('utf8').replace('</head>','<link rel="stylesheet" href="/css/stories.css"><link rel="stylesheet" href="/css/ranking.css"><script defer src="/js/avatar.js"></script><script defer src="/js/stories.js"></script><script defer src="/js/ranking.js"></script><link rel="stylesheet" href="/css/prestige.css"><script defer src="/js/prestige.js"></script></head>'));res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});res.end(data)})
}).listen(port,'0.0.0.0',()=>console.log('Art em Foco online na porta '+port));

setInterval(()=>getDatabase().then(stories.maintenance).catch(()=>{}),60000).unref();
