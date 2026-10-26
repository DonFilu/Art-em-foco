'use strict';
const {ObjectId}=require('mongodb');

let indexes;
const validId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const clean=value=>typeof value==='string'?value.trim().slice(0,1000):'';

async function ensureIndexes(db){
 if(!indexes)indexes=Promise.all([
  db.collection('user_warnings').createIndex({userId:1,reportProtocol:1},{unique:true}),
  db.collection('user_warnings').createIndex({userId:1,acknowledgedAt:1,createdAt:1}),
  db.collection('moderation_audit').createIndex({at:-1}),
  db.collection('moderation_audit').createIndex({reportProtocol:1,at:-1})
 ]).catch(error=>{indexes=null;throw error});
 return indexes;
}

function banFor(user){return user?.moderation?.ban?.active===true?user.moderation.ban:null}
async function state(db,user){
 const ban=banFor(user);
 const warnings=ban?[]:await db.collection('user_warnings').find({userId:user._id,acknowledgedAt:null},{projection:{justification:1,createdAt:1,reportProtocol:1}}).sort({createdAt:1,_id:1}).toArray();
 return {banned:!!ban,ban:ban?{justification:ban.justification||'',at:ban.at||null}:null,warnings:warnings.map(row=>({id:String(row._id),justification:row.justification,createdAt:row.createdAt,protocol:row.reportProtocol}))};
}
async function writeAudit(db,row){await db.collection('moderation_audit').insertOne({...row,at:new Date()})}
async function applyWarning(db,admin,targetUser,protocol,justification){
 const now=new Date(),result=await db.collection('user_warnings').updateOne({userId:targetUser._id,reportProtocol:protocol},{$setOnInsert:{userId:targetUser._id,googleSub:targetUser.googleSub,reportProtocol:protocol,justification,adminUserId:admin.user._id,createdAt:now,acknowledgedAt:null}},{upsert:true});
 if(result.upsertedCount)await writeAudit(db,{type:'warning_applied',adminUserId:admin.user._id,targetUserId:targetUser._id,targetGoogleSub:targetUser.googleSub,reportProtocol:protocol,justification,result:'applied'});
 return result.upsertedCount===1;
}
async function setBan(db,admin,targetUser,protocol,justification,active){
 const now=new Date();
 if(active){
  const result=await db.collection('users').updateOne({_id:targetUser._id,'moderation.ban.active':{$ne:true}},{$set:{'moderation.ban':{active:true,justification,adminUserId:admin.user._id,reportProtocol:protocol,at:now},updatedAt:now}});
  await db.collection('sessions').deleteMany({userId:targetUser._id});
  await writeAudit(db,{type:'ban_applied',adminUserId:admin.user._id,targetUserId:targetUser._id,targetGoogleSub:targetUser.googleSub,reportProtocol:protocol,justification,result:result.modifiedCount?'applied':'already_active'});
  return result.modifiedCount===1;
 }
 const result=await db.collection('users').updateOne({_id:targetUser._id,'moderation.ban.active':true},{$set:{'moderation.ban.active':false,'moderation.ban.reversedAt':now,'moderation.ban.reversedBy':admin.user._id,updatedAt:now}});
 await writeAudit(db,{type:'ban_reversed',adminUserId:admin.user._id,targetUserId:targetUser._id,targetGoogleSub:targetUser.googleSub,reportProtocol:protocol,result:result.modifiedCount?'reversed':'not_active'});
 return result.modifiedCount===1;
}
async function route(req,res,pathname,{sessionUser,getDatabase,json,readJSON}){
 if(!pathname.startsWith('/api/moderation/'))return false;
 try{
  const user=await sessionUser(req);if(!user)return json(res,401,{error:'Entre com Google para continuar'}),true;
  const db=await getDatabase();await ensureIndexes(db);
  if(pathname==='/api/moderation/state'){
   if(req.method!=='GET')return json(res,405,{error:'Método não permitido'}),true;
   return json(res,200,await state(db,user)),true;
  }
  const match=/^\/api\/moderation\/warnings\/([a-f0-9]{24})\/acknowledge$/i.exec(pathname);
  if(!match||req.method!=='POST')return json(res,404,{error:'Rota não encontrada'}),true;
  const result=await db.collection('user_warnings').findOneAndUpdate({_id:new ObjectId(match[1]),userId:user._id,acknowledgedAt:null},{$set:{acknowledgedAt:new Date()}},{returnDocument:'after'});
  if(!result)return json(res,404,{error:'Advertência não encontrada'}),true;
  await writeAudit(db,{type:'warning_acknowledged',targetUserId:user._id,targetGoogleSub:user.googleSub,reportProtocol:result.reportProtocol,result:'acknowledged'});
  return json(res,200,{ok:true}),true;
 }catch(error){return json(res,503,{error:'Não foi possível processar a moderação'}),true}
}
module.exports={ensureIndexes,state,banFor,applyWarning,setBan,route,writeAudit};
