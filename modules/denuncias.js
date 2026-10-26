'use strict';
const crypto=require('crypto');
const {ObjectId}=require('mongodb');
const TYPES=new Set(['post','comment','reply','story','profile']);
const REASONS=new Set(['spam','harassment','inappropriate','copyright','ai_misrepresentation','other']);
const STATUSES=new Set(['received','reviewing','resolved','archived']);
const OPEN=new Set(['received','reviewing']);
const PAGE=20,MAX_TEXT=1000;
let indexesReady;
const validObjectId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const validArtist=value=>typeof value==='string'&&/^AEF-\d{8,}$/.test(value);
const validProtocol=value=>typeof value==='string'&&/^RPT-[A-F0-9]{12}$/.test(value);
const reportProtocol=()=>`RPT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
function text(value,name='Texto'){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string')throw Error(`${name} inválido`);const clean=value.trim();if(clean.length>MAX_TEXT)throw Error(`${name} pode ter no máximo ${MAX_TEXT} caracteres`);return clean}
function publicHistory(history=[]){return history.filter(item=>item.public!==false).map(item=>({at:item.at,statusFrom:item.statusFrom||null,statusTo:item.statusTo,publicMessage:item.publicMessage||''}))}
function publicReport(row){return {protocol:row.protocol,type:row.targetType,reason:row.reason,description:row.description||'',createdAt:row.createdAt,status:row.status,completedAt:row.completedAt||null,publicResult:row.publicResult||'',history:publicHistory(row.history)}}
function cursorQuery(raw){if(!raw)return {};try{const value=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));if(!value?.at||!validObjectId(value.id)||Number.isNaN(new Date(value.at).getTime()))return {};const at=new Date(value.at);return {$or:[{createdAt:{$lt:at}},{createdAt:at,_id:{$lt:new ObjectId(value.id)}}]}}catch{return {}}}
function cursorFor(row){return Buffer.from(JSON.stringify({at:row.createdAt,id:String(row._id)})).toString('base64url')}
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
  if(!validArtist(id))throw Error('Perfil inválido');const artist=await db.collection('users').findOne({artId:id},{projection:{artId:1,displayName:1,username:1,avatar:1,picture:1,avatarUpdatedAt:1}});if(!artist)throw Error('Perfil não encontrado');
  return {type,id,authorId:artist.artId,evidence:{kind:'profile',artistId:artist.artId,name:artist.displayName||artist.username||artist.artId,avatarUpdatedAt:artist.avatarUpdatedAt||null}};
 }
 if(!validObjectId(id))throw Error('Conteúdo inválido');
 if(type==='post'){
  const post=await db.collection('art_posts').findOne({_id:new ObjectId(id)});if(!post||post.deletingAt||!await canViewArt(db,post,user))throw Error('Conteúdo não encontrado ou sem acesso');
  return {type,id,authorId:post.authorId,post,evidence:{kind:'post',description:post.description||'',visibility:post.visibility,createdAt:post.createdAt,publicationType:post.publicationType||'image'}};
 }
 if(type==='comment'||type==='reply'){
  const comment=await db.collection('art_comments').findOne({_id:new ObjectId(id)});if(!comment||((type==='reply')!==!!comment.parentId))throw Error('Conteúdo não encontrado');
  const post=await db.collection('art_posts').findOne({_id:comment.postId});if(!post||post.deletingAt||!await canViewArt(db,post,user))throw Error('Conteúdo não encontrado ou sem acesso');
  return {type,id,authorId:comment.authorId,evidence:{kind:type,text:comment.text,createdAt:comment.createdAt,postId:String(post._id)}};
 }
 const story=await db.collection('stories').findOne({_id:new ObjectId(id),deletedAt:null,expiresAt:{$gt:new Date()}});if(!story)throw Error('Story indisponível');
 return {type,id,authorId:story.authorId,evidence:{kind:'story',text:story.text,color:story.color,link:story.link||'',createdAt:story.createdAt,expiresAt:story.expiresAt}};
}
async function submit(db,user,body,canViewArt,capturePostEvidence=async()=>({media:[],claims:[],createdIds:[]}),releaseEvidenceClaims=async()=>{},discardEvidence=async()=>{}){
 const target=await targetFor(db,user,body,canViewArt);if(target.authorId===user.artId)throw Error('Você não pode denunciar seu próprio conteúdo');
 if(!REASONS.has(body?.reason))throw Error('Motivo inválido');const description=text(body?.description,'Descrição'),now=new Date();
 if(await db.collection('reports').countDocuments({reporterId:user._id,createdAt:{$gte:new Date(now.getTime()-60000)}})>=5){const error=Error('Aguarde antes de enviar novas denúncias');error.status=429;throw error}if(await db.collection('reports').findOne({reporterId:user._id,targetType:target.type,targetId:target.id,open:true},{projection:{_id:1}})){const error=Error('Você já possui uma denúncia em aberto para este conteúdo');error.status=409;throw error}
 let capture={media:[],claims:[],createdIds:[]};if(target.post)capture=await capturePostEvidence(db,target.post);const row={protocol:reportProtocol(),targetType:target.type,targetId:target.id,reportedAuthorId:target.authorId,reporterId:user._id,reason:body.reason,description,evidence:{...target.evidence,...(target.post?{media:capture.media}:{})},status:'received',open:true,createdAt:now,updatedAt:now,history:[{at:now,statusFrom:null,statusTo:'received',public:true,publicMessage:'Denúncia recebida.'}],internalNotes:[]};
 try{await db.collection('reports').insertOne(row)}catch(error){await releaseEvidenceClaims(db,capture.claims);await discardEvidence(db,capture.createdIds);if(error.code===11000){const duplicate=Error('Você já possui uma denúncia em aberto para este conteúdo');duplicate.status=409;throw duplicate}throw error}await releaseEvidenceClaims(db,capture.claims);
 return {protocol:row.protocol,status:row.status,createdAt:row.createdAt};
}
async function mine(db,user,params){const rows=await db.collection('reports').find({reporterId:user._id,...cursorQuery(params.get('cursor'))},{projection:{protocol:1,targetType:1,reason:1,createdAt:1,status:1}}).sort({createdAt:-1,_id:-1}).limit(PAGE+1).toArray(),more=rows.length>PAGE;if(more)rows.pop();return {reports:rows.map(row=>({protocol:row.protocol,type:row.targetType,reason:row.reason,createdAt:row.createdAt,status:row.status})),nextCursor:more?cursorFor(rows.at(-1)):null}}
function adminFilter(params){const query={},status=params.get('status'),type=params.get('type'),protocol=params.get('q')?.trim(),from=params.get('from'),to=params.get('to');if(status){if(!STATUSES.has(status))throw Error('Status inválido');query.status=status}if(type){if(!TYPES.has(type))throw Error('Tipo inválido');query.targetType=type}if(protocol){if(!validProtocol(protocol))throw Error('Protocolo inválido');query.protocol=protocol}if(from||to){const start=from?new Date(`${from}T00:00:00.000Z`):null,end=to?new Date(`${to}T23:59:59.999Z`):null;if((start&&Number.isNaN(start))||(end&&Number.isNaN(end))||(start&&end&&start>end))throw Error('Intervalo de datas inválido');query.createdAt={};if(start)query.createdAt.$gte=start;if(end)query.createdAt.$lte=end}return query}
async function adminList(db,params){const query={...adminFilter(params),...cursorQuery(params.get('cursor'))},rows=await db.collection('reports').find(query,{projection:{protocol:1,targetType:1,targetId:1,reason:1,reportedAuthorId:1,createdAt:1,status:1}}).sort({createdAt:-1,_id:-1}).limit(PAGE+1).toArray(),more=rows.length>PAGE;if(more)rows.pop();const targets=rows.map(row=>({targetType:row.targetType,targetId:row.targetId}));const grouped=targets.length?await db.collection('reports').aggregate([{$match:{$or:targets}},{$group:{_id:{type:'$targetType',id:'$targetId'},count:{$sum:1},reasons:{$push:'$reason'}}}]).toArray():[],byTarget=new Map(grouped.map(item=>[`${item._id.type}:${item._id.id}`,item]));return {reports:rows.map(row=>({...row,related:byTarget.get(`${row.targetType}:${row.targetId}`)?.count||1,reasonCounts:(byTarget.get(`${row.targetType}:${row.targetId}`)?.reasons||[]).reduce((out,reason)=>(out[reason]=(out[reason]||0)+1,out),{})})),nextCursor:more?cursorFor(rows.at(-1)):null}}
async function update(db,admin,protocolValue,body){
 if(!validProtocol(protocolValue)||!STATUSES.has(body?.status))throw Error('Atualização inválida');const internal=text(body.internalNote,'Observação interna'),publicResult=text(body.publicResult,'Resposta pública'),now=new Date(),open=OPEN.has(body.status),history={at:now,statusTo:body.status,adminId:admin.user._id,public:!!publicResult,publicMessage:publicResult};
 const set={status:body.status,open,updatedAt:now};if(!open)set.completedAt=now;else set.completedAt=null;if(publicResult)set.publicResult=publicResult;
 const result=await db.collection('reports').findOneAndUpdate({protocol:protocolValue},[{$set:{_previousStatus:'$status'}},{$set:{...set,history:{$concatArrays:[{$ifNull:['$history',[]]},[{...history,statusFrom:'$_previousStatus'}]]},internalNotes:internal?{$concatArrays:[{$ifNull:['$internalNotes',[]]},[{at:now,adminId:admin.user._id,text:internal}]]}:{$ifNull:['$internalNotes',[]]}}},{$unset:'_previousStatus'}],{returnDocument:'after'});if(!result)throw Error('Denúncia não encontrada');return result;
}
async function detail(db,protocolValue){const row=await db.collection('reports').findOne({protocol:protocolValue});if(!row)return null;const ids=[row.reporterId],users=await db.collection('users').find({_id:{$in:ids}},{projection:{artId:1,displayName:1,username:1}}).toArray(),reporter=users[0]?{id:users[0].artId,name:users[0].displayName||users[0].username||users[0].artId}:null;const related=await db.collection('reports').countDocuments({targetType:row.targetType,targetId:row.targetId});return {...row,reporter,related};}
async function removeByAdmin(db,admin,protocolValue,body,discardEvidence){if(!validProtocol(protocolValue)||body?.confirm!==true)throw Error('Confirmação de exclusão inválida');const audit=await db.collection('admin_audit').insertOne({type:'report_delete',adminUserId:admin.user._id,reportProtocol:protocolValue,at:new Date(),outcome:'requested'}),removed=await db.collection('reports').findOneAndDelete({protocol:protocolValue});if(!removed){await db.collection('admin_audit').updateOne({_id:audit.insertedId},{$set:{outcome:'not_found',completedAt:new Date()}});throw Error('Denúncia não encontrada')}await db.collection('admin_audit').updateOne({_id:audit.insertedId},{$set:{outcome:'deleted',completedAt:new Date()}});try{await discardEvidence(db,(removed.evidence?.media||[]).map(media=>media.fileId))}catch{await db.collection('admin_audit').updateOne({_id:audit.insertedId},{$set:{evidenceCleanup:'deferred'}})}return true}
async function applyAdministrativeAction(db,admin,protocolValue,body,moderation,removeContent){
 if(!validProtocol(protocolValue)||body?.confirm!==true)throw Error('Confirmação das ações inválida');
 await moderation.ensureIndexes(db);const actions=body.actions||{};
 if(!actions||typeof actions!=='object'||Array.isArray(actions))throw Error('Ações inválidas');
 const remove=actions.removeContent===true,warn=actions.warning===true,ban=actions.ban===true,unban=actions.unban===true;
 if(!remove&&!warn&&!ban&&!unban&&!body.status)throw Error('Selecione ao menos uma decisão');
 if(ban&&unban)throw Error('Decisão de banimento inválida');
 if(body.status&&!STATUSES.has(body.status))throw Error('Status inválido');
 const justification=text(body.justification,'Justificativa administrativa');
 if((remove||warn||ban||unban)&&!justification)throw Error('Escreva uma justificativa administrativa');
 const lock=await db.collection('reports').findOneAndUpdate({protocol:protocolValue,'administrativeAction.lockedAt':{$exists:false}},{$set:{'administrativeAction.lockedAt':new Date(),'administrativeAction.adminId':admin.user._id}},{returnDocument:'after'});
 if(!lock)throw Error('Esta denúncia está sendo processada por outro administrador');
 const report=lock;
 try{
  const target=await db.collection('users').findOne({artId:report.reportedAuthorId});
  if(!target)throw Error('Usuário denunciado não encontrado');
  const results=[];
  if(remove){
   if(!['post','comment','reply','story'].includes(report.targetType))throw Error('Este tipo de conteúdo não pode ser excluído por esta ação');
   const outcome=await removeContent(db,report,admin,justification);
   if(outcome!=='deleted')throw Error(outcome==='missing'?'O conteúdo já foi excluído ou não está disponível':'Não foi possível excluir o conteúdo');
   results.push('conteúdo excluído');
  }
  if(warn){await moderation.applyWarning(db,admin,target,report.protocol,justification);results.push('advertência registrada')}
  if(ban){await moderation.setBan(db,admin,target,report.protocol,justification,true);results.push('banimento aplicado')}
  if(unban){await moderation.setBan(db,admin,target,report.protocol,justification,false);results.push('banimento revertido')}
  const now=new Date(),status=body.status||report.status,open=OPEN.has(status),decision={at:now,adminId:admin.user._id,actions:{removeContent:remove,warning:warn,ban,unban},justification,result:results};
  await db.collection('reports').updateOne({_id:report._id},{$set:{status,open,updatedAt:now,completedAt:open?null:now,'administrativeAction.completedAt':now,'administrativeAction.results':results},$unset:{'administrativeAction.lockedAt':'','administrativeAction.adminId':''},$push:{administrativeDecisions:decision,history:{at:now,statusFrom:report.status,statusTo:status,adminId:admin.user._id,public:false}}});
  await moderation.writeAudit?.(db,{type:'report_decision',adminUserId:admin.user._id,targetUserId:target._id,targetGoogleSub:target.googleSub,reportProtocol:report.protocol,action:decision.actions,result:results.join(',')});
  return {results};
 }catch(error){
  await db.collection('reports').updateOne({_id:report._id},{$unset:{'administrativeAction.lockedAt':'','administrativeAction.adminId':''}}).catch(()=>{});
  throw error;
 }
}
async function route(req,res,pathname,{sessionUser,getDatabase,json,readJSON,canViewArt,gestao,capturePostEvidence,readReportEvidence,releaseReportEvidenceClaims,discardReportEvidence,moderation,removeContent}){
 const adminPath=pathname.startsWith('/api/gestao/denuncias'),minePath=pathname.startsWith('/api/denuncias');if(!adminPath&&!minePath)return false;
 try{const params=new URL(req.url,'http://localhost').searchParams;if(adminPath&&!gestao.configured())return json(res,403,{error:'Acesso administrativo indisponível'}),true;if(!adminPath&&!await sessionUser(req))return json(res,401,{error:'Entre com Google para acessar denúncias'}),true;const db=await getDatabase();await ensureIndexes(db);
  if(adminPath){const admin=await gestao.requireAdmin(req,res,db,sessionUser,json,{csrf:req.method!=='GET'});if(!admin)return true;const evidenceMatch=/^\/api\/gestao\/denuncias\/evidence\/([a-f0-9]{24})$/.exec(pathname);if(evidenceMatch){if(req.method!=='GET')return json(res,405,{error:'Método não permitido'}),true;const referenced=await db.collection('reports').findOne({'evidence.media.fileId':evidenceMatch[1]},{projection:{_id:1}});if(!referenced)return json(res,404,{error:'Evidência não encontrada'}),true;const media=await readReportEvidence(db,evidenceMatch[1]);if(!media)return json(res,404,{error:'Evidência não encontrada'}),true;res.writeHead(200,{'Content-Type':media.mime,'Content-Length':media.bytes.length,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'X-Frame-Options':'DENY'});res.end(media.bytes);return true}if(pathname==='/api/gestao/denuncias'&&req.method==='GET'){const counts=await db.collection('reports').aggregate([{$group:{_id:'$status',count:{$sum:1}}}]).toArray(),summary={total:0,received:0,reviewing:0,resolved:0,archived:0};for(const count of counts){summary[count._id]=count.count;summary.total+=count.count}return json(res,200,{summary,...await adminList(db,params)}),true}const actionMatch=/^\/api\/gestao\/denuncias\/(RPT-[A-F0-9]{12})\/actions$/.exec(pathname);if(actionMatch){if(req.method!=='POST')return json(res,405,{error:'Método não permitido'}),true;return json(res,200,await applyAdministrativeAction(db,admin,actionMatch[1],await readJSON(req),moderation,removeContent)),true}const match=/^\/api\/gestao\/denuncias\/(RPT-[A-F0-9]{12})$/.exec(pathname);if(!match)return json(res,404,{error:'Denúncia não encontrada'}),true;if(req.method==='GET'){const row=await detail(db,match[1]);return row?json(res,200,{report:row}):json(res,404,{error:'Denúncia não encontrada'}),true}if(req.method==='PATCH'){await update(db,admin,match[1],await readJSON(req));return json(res,200,{ok:true}),true}if(req.method==='DELETE'){await removeByAdmin(db,admin,match[1],await readJSON(req),discardReportEvidence);return json(res,200,{ok:true}),true}return json(res,405,{error:'Método não permitido'}),true}
  const user=await sessionUser(req);if(pathname==='/api/denuncias'){if(req.method==='POST')return json(res,201,await submit(db,user,await readJSON(req),canViewArt,capturePostEvidence,releaseReportEvidenceClaims,discardReportEvidence)),true;if(req.method==='GET')return json(res,200,await mine(db,user,params)),true;return json(res,405,{error:'Método não permitido'}),true}const match=/^\/api\/denuncias\/(RPT-[A-F0-9]{12})$/.exec(pathname);if(!match||req.method!=='GET')return json(res,404,{error:'Denúncia não encontrada'}),true;const row=await db.collection('reports').findOne({protocol:match[1],reporterId:user._id});return row?json(res,200,{report:publicReport(row)}):json(res,404,{error:'Denúncia não encontrada'}),true;
 }catch(error){const status=error.status||(/inválid|encontrado|acesso|próprio|Descrição|Observação|Resposta|Intervalo/i.test(error.message)?400:503);return json(res,status,{error:error.message||'Não foi possível processar a denúncia'}),true}
}
module.exports={route,submit,targetFor,publicReport,adminFilter,update,removeByAdmin,applyAdministrativeAction,REASONS,TYPES,STATUSES};
