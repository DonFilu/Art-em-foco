'use strict';
const crypto=require('crypto');
const LEASE_MS=90*1000;
let indexes;

async function ensureIndexes(db){
 if(!indexes)indexes=Promise.all([
  db.collection('moderation_content_removals').createIndex({reportProtocol:1,targetType:1,targetId:1},{unique:true}),
  db.collection('moderation_content_removals').createIndex({state:1,leaseExpiresAt:1})
 ]).catch(error=>{indexes=null;throw error});
 return indexes;
}
async function acquire(db,report,files,now=new Date()){
 await ensureIndexes(db);const jobs=db.collection('moderation_content_removals'),leaseId=crypto.randomUUID(),expiresAt=new Date(now.getTime()+LEASE_MS),seed={reportProtocol:report.protocol,targetType:report.targetType,targetId:report.targetId,authorId:report.reportedAuthorId,files,deletedFileIds:[],state:'pending',createdAt:now};
 try{
  const job=await jobs.findOneAndUpdate({reportProtocol:report.protocol,targetType:report.targetType,targetId:report.targetId,state:{$ne:'completed'},$or:[{leaseExpiresAt:{$exists:false}},{leaseExpiresAt:{$lte:now}}]},{$setOnInsert:seed,$set:{leaseId,leaseExpiresAt:expiresAt,updatedAt:now,lastAttemptAt:now,state:'processing'}},{upsert:true,returnDocument:'after'});
  return job?{job,leaseId}:null;
 }catch(error){if(error.code!==11000)throw error;const job=await jobs.findOneAndUpdate({reportProtocol:report.protocol,targetType:report.targetType,targetId:report.targetId,state:{$ne:'completed'},$or:[{leaseExpiresAt:{$exists:false}},{leaseExpiresAt:{$lte:now}}]},{$set:{leaseId,leaseExpiresAt:expiresAt,updatedAt:now,lastAttemptAt:now,state:'processing'}},{returnDocument:'after'});return job?{job,leaseId}:null}
}
async function renew(db,id,leaseId){const result=await db.collection('moderation_content_removals').updateOne({_id:id,leaseId,state:'processing'},{$set:{leaseExpiresAt:new Date(Date.now()+LEASE_MS),updatedAt:new Date()}});if(!result.modifiedCount)throw Error('A remoção perdeu o bloqueio de segurança')}
async function fail(db,id,leaseId,error){await db.collection('moderation_content_removals').updateOne({_id:id,leaseId},{$set:{state:'pending',lastError:String(error.message||error).slice(0,500),updatedAt:new Date()},$unset:{leaseId:'',leaseExpiresAt:''}})}
async function complete(db,id,leaseId){await db.collection('moderation_content_removals').updateOne({_id:id,leaseId,state:'processing'},{$set:{state:'completed',completedAt:new Date(),updatedAt:new Date()},$unset:{leaseId:'',leaseExpiresAt:'',lastError:''}})}
async function runPostRemoval(db,report,files,{removeFile,finalize}){
 const claimed=await acquire(db,report,files);if(!claimed)return {state:'busy'};const {job,leaseId}=claimed;
 try{
  for(const fileId of job.files||files){if((job.deletedFileIds||[]).includes(fileId))continue;await renew(db,job._id,leaseId);await removeFile(fileId);const marked=await db.collection('moderation_content_removals').updateOne({_id:job._id,leaseId,state:'processing'},{$addToSet:{deletedFileIds:fileId},$set:{updatedAt:new Date()}});if(!marked.modifiedCount)throw Error('A remoção perdeu o bloqueio de segurança')}
  await renew(db,job._id,leaseId);await finalize();await complete(db,job._id,leaseId);return {state:'deleted'};
 }catch(error){await fail(db,job._id,leaseId,error).catch(()=>{});return {state:'pending',error};}
}
module.exports={ensureIndexes,acquire,renew,runPostRemoval,LEASE_MS};
