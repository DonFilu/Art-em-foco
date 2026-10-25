'use strict';
const crypto=require('crypto');
const {ObjectId}=require('mongodb');
const TYPES=new Set(['post','comment','reply','story','profile']);
const REASONS=new Set(['spam','harassment','inappropriate','copyright','ai_misrepresentation','other']);
const STATUSES=new Set(['received','reviewing','resolved','archived']);
const OPEN=new Set(['received','reviewing']);
const MAX_DESCRIPTION=1000,PAGE=20;
let indexesReady;
const validObjectId=id=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id);
const validArtist=id=>typeof id==='string'&&/^AEF-\d{8,}$/.test(id);
function protocol(){return 'RPT-'+crypto.randomBytes(6).toString('hex').toUpperCase()}
function cleanDescription(value){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string')throw Error('Descrição inválida');const clean=value.trim();if(clean.length>MAX_DESCRIPTION)throw Error('A descrição pode ter no máximo 1000 caracteres');return clean}
function publicHistory(history=[]){return history.filter(item=>item.public!==false).map(item=>({at:item.at,statusFrom:item.statusFrom||null,statusTo:item.statusTo,publicMessage:item.publicMessage||''}))}
function publicReport(row){return {protocol:row.protocol,type:row.targetType,reason:row.reason,description:row.description||'',createdAt:row.createdAt,status:row.status,completedAt:row.completedAt||null,publicResult:row.publicResult||'',history:publicHistory(row.history)}}
async function ensureIndexes(db){if(!indexesReady)indexesReady=Promise.all([
 db.collection('reports').createIndex({protocol:1},{unique:true}),
 db.collection('reports').createIndex({reporterId:1,createdAt:-1}),
 db.collection('reports').createIndex({targetType:1,targetId:1,status:1,createdAt:-1}),
 db.collection('reports').createIndex({reporterId:1,targetType:1,targetId:1,open:1},{unique:true,partialFilterExpression:{open:true}}),
 db.collection('reports').createIndex({status:1,createdAt:-1}),
 db.collection('reports').createIndex({reportedAuthorId:1,createdAt:-1})
]).catch(error=>{indexesReady=null;throw error});return indexesReady}
async function targetFor(db,user,body,canViewArt){
 const type=body?.type,id=body?.targetId;if(!TYPES.has(type))throw Error('Tipo de conteúdo inválido');
 if(type==='profile'){
  if(!validArtist(id))throw Error('Perfil inválido');const artist=await db.collection('users').findOne({artId:id},{projection:{artId:1,displayName:1,username:1}});if(!artist)throw Error('Perfil não encontrado');
  return {type,id,authorId:artist.artId,evidence:{kind:'profile',artistId:artist.artId,name:artist.displayName||artist.username||artist.artId}};
 }
 if(!validObjectId(id))throw Error('Conteúdo inválido');
 if(type==='post'){
  const post=await db.collection('art_posts').findOne({_id:new ObjectId(id)});if(!post||post.deletingAt||!await canViewArt(db,post,user))throw Error('Conteúdo não encontrado ou sem acesso');
  return {type,id,authorId:post.authorId,evidence:{kind:'post',description:post.description||'',visibility:post.visibility,createdAt:post.createdAt,publicationType:post.publicationType||'image'}};
 }
 if(type==='comment'||type==='reply'){
  const comment=await db.collection('art_comments').findOne({_id:new ObjectId(id)});if(!comment||((type==='reply')!==!!comment.parentId))throw Error('Conteúdo não encontrado');
  const post=await db.collection('art_posts').findOne({_id:comment.postId});if(!post||post.deletingAt||!await canViewArt(db,post,user))throw Error('Conteúdo não encontrado ou sem acesso');
  return {type,id,authorId:comment.authorId,evidence:{kind:type,text:comment.text,createdAt:comment.createdAt,postId:String(post._id)}};
 }
 const story=await db.collection('stories').findOne({_id:new ObjectId(id),deletedAt:null,expiresAt:{$gt:new Date()}});
 if(!story)throw Error('Story indisponível');
 return {type,id,authorId:story.authorId,evidence:{kind:'story',text:story.text,color:story.color,link:story.link||'',createdAt:story.createdAt,expiresAt:story.expiresAt}};
}
async function submit(db,user,body,canViewArt){
 const target=await targetFor(db,user,body,canViewArt);if(target.authorId===user.artId)throw Error('Você não pode denunciar seu próprio conteúdo');
 const reason=body?.reason;if(!REASONS.has(reason))throw Error('Motivo inválido');
 const description=cleanDescription(body?.description);
 const now=new Date(),recent=await db.collection('reports').countDocuments({reporterId:user._id,createdAt:{$gte:new Date(now.getTime()-60000)}});
 if(recent>=5){const error=Error('Aguarde antes de enviar novas denúncias');error.status=429;throw error}
 const row={protocol:protocol(),targetType:target.type,targetId:target.id,reportedAuthorId:target.authorId,reporterId:user._id,reason,description,evidence:target.evidence,status:'received',open:true,createdAt:now,updatedAt:now,history:[{at:now,statusFrom:null,statusTo:'received',public:true,publicMessage:'Denúncia recebida.'}]};
 try{await db.collection('reports').insertOne(row)}catch(error){if(error.code===11000){const duplicate=Error('Você já possui uma denúncia em aberto para este conteúdo');duplicate.status=409;throw duplicate}throw error}
 return {protocol:row.protocol,status:row.status,createdAt:row.createdAt};
}
function cursorQuery(cursor){if(!cursor)return {};try{const d=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));return d?.at&&validObjectId(d.id)?{$or:[{createdAt:{$lt:new Date(d.at)}},{createdAt:new Date(d.at),_id:{$lt:new ObjectId(d.id)}}]}:{}}catch{return {}}}
function cursorFor(row){return Buffer.from(JSON.stringify({at:row.createdAt,id:String(row._id)})).toString('base64url')}
async function mine(db,user,params){const query={reporterId:user._id,...cursorQuery(params.get('cursor'))};const rows=await db.collection('reports').find(query,{projection:{protocol:1,targetType:1,reason:1,createdAt:1,status:1}}).sort({createdAt:-1,_id:-1}).limit(PAGE+1).toArray();const more=rows.length>PAGE;if(more)rows.pop();return {reports:rows.map(row=>({protocol:row.protocol,type:row.targetType,reason:row.reason,createdAt:row.createdAt,status:row.status})),nextCursor:more?cursorFor(rows.at(-1)):null}}
async function adminList(db,params){const query={},status=params.get('status'),type=params.get('type'),q=(params.get('q')||'').trim(),from=params.get('from'),to=params.get('to');if(STATUSES.has(status))query.status=status;if(TYPES.has(type))query.targetType=type;if(/^RPT-[A-F0-9]{12}$/.test(q))query.protocol=q;if(/^\d{4}-\d{2}-\d{2}$/.test(from)||/^\d{4}-\d{2}-\d{2}$/.test(to)){query.createdAt={};if(from)query.createdAt.$gte=new Date(from+'T00:00:00.000Z');if(to)query.createdAt.$lt=new Date(to+'T00:00:00.000Z')}const rows=await db.collection('reports').find(query,{projection:{protocol:1,targetType:1,targetId:1,reason:1,reportedAuthorId:1,createdAt:1,status:1}}).sort({createdAt:-1,_id:-1}).limit(100).toArray();const grouped=await db.collection('reports').aggregate([{$match:query},{$group:{_id:{type:'$targetType',id:'$targetId'},count:{$sum:1},reasons:{$push:'$reason'}}}]).toArray(),byTarget=new Map(grouped.map(row=>[row._id.type+':'+row._id.id,row]));return {reports:rows.map(row=>({...row,related:byTarget.get(row.targetType+':'+row.targetId)?.count||1,reasonCounts:(byTarget.get(row.targetType+':'+row.targetId)?.reasons||[]).reduce((all,reason)=>{all[reason]=(all[reason]||0)+1;return all},{})}))}}
async function update(db,admin,protocolValue,body){if(!/^RPT-[A-F0-9]{12}$/.test(protocolValue))throw Error('Protocolo inválido');const status=body?.status;if(!STATUSES.has(status))throw Error('Status inválido');const internal=cleanDescription(body?.internalNote),publicResult=cleanDescription(body?.publicResult);const row=await db.collection('reports').findOne({protocol:protocolValue});if(!row)throw Error('Denúncia não encontrada');const now=new Date(),entry={at:now,statusFrom:row.status,statusTo:status,adminId:admin.user._id,public:!!publicResult,publicMessage:publicResult};const set={status,updatedAt:now,open:OPEN.has(status),history:[...(row.history||[]),entry]};if(internal)set.internalNotes=[...(row.internalNotes||[]),{at:now,adminId:admin.user._id,text:internal}];if(publicResult)set.publicResult=publicResult;if(!OPEN.has(status))set.completedAt=now;await db.collection('reports').updateOne({_id:row._id},{$set:set});return true}
async function route(req,res,pathname,{sessionUser,getDatabase,json,readJSON,canViewArt,gestao}){
 const adminPath=pathname.startsWith('/api/gestao/denuncias');const minePath=pathname.startsWith('/api/denuncias');if(!adminPath&&!minePath)return false;
 try{const params=new URL(req.url,'http://localhost').searchParams;if(adminPath&&!gestao.configured())return json(res,403,{error:'Acesso administrativo indisponível'}),true;if(!adminPath){const unauthenticated=await sessionUser(req);if(!unauthenticated)return json(res,401,{error:'Entre com Google para acessar denúncias'}),true}const db=await getDatabase();await ensureIndexes(db);
  if(adminPath){const admin=await gestao.requireAdmin(req,res,db,sessionUser,json,{csrf:req.method!=='GET'});if(!admin)return true;if(pathname==='/api/gestao/denuncias'&&req.method==='GET'){const counts=await db.collection('reports').aggregate([{$group:{_id:'$status',count:{$sum:1}}}]).toArray(),summary={total:0,received:0,reviewing:0,resolved:0,archived:0};for(const item of counts){summary[item._id]=item.count;summary.total+=item.count}return json(res,200,{summary,...await adminList(db,params)}),true}const match=/^\/api\/gestao\/denuncias\/(RPT-[A-F0-9]{12})$/.exec(pathname);if(!match)return json(res,404,{error:'Denúncia não encontrada'}),true;if(req.method==='GET'){const row=await db.collection('reports').findOne({protocol:match[1]});if(!row)return json(res,404,{error:'Denúncia não encontrada'}),true;const reporters=await db.collection('users').find({_id:{$in:[row.reporterId]}},{projection:{artId:1,displayName:1,username:1}}).toArray();return json(res,200,{report:{...row,reporter:reporters[0]?{id:reporters[0].artId,name:reporters[0].displayName||reporters[0].username||reporters[0].artId}:null}}),true}if(req.method==='PATCH'){await update(db,admin,match[1],await readJSON(req));return json(res,200,{ok:true}),true}return json(res,405,{error:'Método não permitido'}),true}
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Entre com Google para acessar denúncias'}),true;
  if(pathname==='/api/denuncias'){if(req.method==='POST'){const result=await submit(db,user,await readJSON(req),canViewArt);return json(res,201,result),true}if(req.method==='GET')return json(res,200,await mine(db,user,params)),true;return json(res,405,{error:'Método não permitido'}),true}
  const match=/^\/api\/denuncias\/(RPT-[A-F0-9]{12})$/.exec(pathname);if(!match||req.method!=='GET')return json(res,404,{error:'Denúncia não encontrada'}),true;const row=await db.collection('reports').findOne({protocol:match[1],reporterId:user._id});if(!row)return json(res,404,{error:'Denúncia não encontrada'}),true;return json(res,200,{report:publicReport(row)}),true;
 }catch(error){const status=error.status||(/inválid|encontrado|acesso|próprio|Descrição/i.test(error.message)?400:503);return json(res,status,{error:error.message||'Não foi possível processar a denúncia'}),true}
}
module.exports={route,submit,targetFor,publicReport,REASONS,TYPES,STATUSES};
