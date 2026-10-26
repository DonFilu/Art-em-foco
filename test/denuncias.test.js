'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const reports=require('../modules/denuncias');
const moderation=require('../modules/user-moderation');
const removals=require('../modules/moderation-removals');
const source=require('node:fs').readFileSync(require.resolve('../modules/denuncias'),'utf8');

test('public report details never expose reporter identity, evidence, or internal notes',()=>{
 const output=reports.publicReport({protocol:'RPT-ABCDEF123456',targetType:'post',reason:'spam',description:'descrição',createdAt:new Date('2026-01-01'),status:'resolved',reporterId:'private',evidence:{text:'private'},internalNotes:[{text:'private'}],history:[{at:new Date('2026-01-01'),statusTo:'received',public:true,publicMessage:'Recebida'},{at:new Date('2026-01-02'),statusTo:'resolved',public:false,publicMessage:'interno'}]});
 assert.deepEqual(Object.keys(output).sort(),['completedAt','createdAt','description','history','protocol','publicResult','reason','status','type']);
 assert.equal(output.history.length,1);
 assert.equal(output.history[0].publicMessage,'Recebida');
});
test('report module validates fixed target types, reasons, status transitions and persistent duplicate protection',()=>{
 assert.match(source,/const TYPES=new Set\(\['post','comment','reply','story','profile'\]\)/);
 assert.match(source,/partialFilterExpression:\{open:true\}/);
 assert.match(source,/reporterId:1,targetType:1,targetId:1,open:1/);
 assert.match(source,/createdAt:\{\$gte:new Date\(now\.getTime\(\)-60000\)\}/);
 assert.match(source,/gestao\.requireAdmin/);
});
test('unauthenticated report endpoints are rejected before database access',async()=>{
 let response;
 const handled=await reports.route({method:'GET',url:'/api/denuncias',headers:{}},{},'/api/denuncias',{sessionUser:async()=>null,getDatabase:async()=>{throw Error('database must not be called')},json:(_res,status,body)=>{response={status,body}},readJSON:async()=>({}),canViewArt:async()=>false,gestao:{configured:()=>false}});
 assert.equal(handled,true);
 assert.equal(response.status,401);
});
test('administrative filters validate dates and include the selected final day',()=>{
 const filter=reports.adminFilter(new URLSearchParams('status=reviewing&type=post&from=2026-01-01&to=2026-01-02'));
 assert.equal(filter.status,'reviewing');
 assert.equal(filter.targetType,'post');
 assert.equal(filter.createdAt.$gte.toISOString(),'2026-01-01T00:00:00.000Z');
 assert.equal(filter.createdAt.$lte.toISOString(),'2026-01-02T23:59:59.999Z');
 assert.throws(()=>reports.adminFilter(new URLSearchParams('from=2026-02-02&to=2026-02-01')),/Intervalo/);
});
test('administrative updates use an aggregation pipeline instead of replacing history from a stale read',async()=>{
 let pipeline;
 const db={collection:()=>({findOneAndUpdate:async(_query,value)=>{pipeline=value;return {_id:'report'}}})};
 await reports.update(db,{user:{_id:'admin'}},'RPT-ABCDEF123456',{status:'reviewing',internalNote:'nota',publicResult:''});
 assert.equal(Array.isArray(pipeline),true);
 assert.match(JSON.stringify(pipeline),/\$concatArrays/);
 assert.match(JSON.stringify(pipeline),/_previousStatus/);
});
test('an already open duplicate is rejected before post evidence capture',async()=>{
 let captures=0;
 const post={_id:{toString:()=> 'a'.repeat(24)},authorId:'AEF-00000002',visibility:'public',description:'arte'};
 const db={collection:name=>name==='art_posts'?{findOne:async()=>post}:{countDocuments:async()=>0,findOne:async()=>({_id:'existing'})}};
 await assert.rejects(()=>reports.submit(db,{_id:'user',artId:'AEF-00000001'},{type:'post',targetId:'a'.repeat(24),reason:'spam'},async()=>true,async()=>{captures++;return {media:[],claims:[],createdIds:[]}}),/já possui/);
 assert.equal(captures,0);
});
test('a failed report insert releases claims and discards only newly captured evidence',async()=>{
 const post={_id:{toString:()=> 'b'.repeat(24)},authorId:'AEF-00000002',visibility:'public',description:'arte'};let released,discarded;
 const reportsCollection={countDocuments:async()=>0,findOne:async()=>null,insertOne:async()=>{throw Error('falha')}};
 const db={collection:name=>name==='art_posts'?{findOne:async()=>post}:reportsCollection};
 await assert.rejects(()=>reports.submit(db,{_id:'user',artId:'AEF-00000001'},{type:'post',targetId:'b'.repeat(24),reason:'spam'},async()=>true,async()=>({media:[{fileId:'c'.repeat(24)}],claims:['c'.repeat(24)],createdIds:['c'.repeat(24)]}),async(_db,ids)=>{released=ids},async(_db,ids)=>{discarded=ids}));
 assert.deepEqual(released,['c'.repeat(24)]);
 assert.deepEqual(discarded,['c'.repeat(24)]);
});
test('administrative deletion requires confirmation, audits the operation, and only discards selected evidence',async()=>{
 const updates=[],discarded=[];
 const db={collection:name=>name==='admin_audit'?{insertOne:async()=>({insertedId:'audit'}),updateOne:async(_id,update)=>updates.push(update)}:{findOneAndDelete:async query=>({protocol:query.protocol,evidence:{media:[{fileId:'d'.repeat(24)}]}})}};
 await assert.rejects(()=>reports.removeByAdmin(db,{user:{_id:'admin'}},'RPT-ABCDEF123456',{confirm:false},async()=>{}),/Confirmação/);
 await reports.removeByAdmin(db,{user:{_id:'admin'}},'RPT-ABCDEF123456',{confirm:true},async(_db,ids)=>discarded.push(...ids));
 assert.deepEqual(discarded,['d'.repeat(24)]);
 assert.equal(updates.some(update=>update.$set?.outcome==='deleted'),true);
});
test('administrative decisions are locked, require justification, and record independent actions',async()=>{
 const report={_id:'report-id',protocol:'RPT-ABCDEF123456',targetType:'post',targetId:'a'.repeat(24),reportedAuthorId:'AEF-00000002',status:'received'};
 const updates=[],calls=[];
 const db={collection:name=>name==='reports'?{findOneAndUpdate:async()=>report,updateOne:async(_query,update)=>{updates.push(update);return {modifiedCount:1}}}:name==='users'?{findOne:async()=>({_id:'target',googleSub:'123456789012',artId:'AEF-00000002'})}:{}};
 const service={ensureIndexes:async()=>{},applyWarning:async(...args)=>calls.push(['warning',args]),setBan:async(...args)=>calls.push(['ban',args]),writeAudit:async(...args)=>calls.push(['audit',args])};
 await assert.rejects(()=>reports.applyAdministrativeAction(db,{user:{_id:'admin'}},report.protocol,{confirm:true,actions:{warning:true},justification:''},service,async()=>{}),/justificativa/i);
 const result=await reports.applyAdministrativeAction(db,{user:{_id:'admin'}},report.protocol,{confirm:true,status:'resolved',justification:'Violação confirmada',actions:{removeContent:true,warning:true,ban:true}},service,async()=>{calls.push(['remove']);return 'deleted'});
 assert.deepEqual(result.results,['conteúdo excluído','advertência registrada','banimento aplicado']);
 assert.equal(calls.filter(call=>call[0]==='remove').length,1);
 assert.equal(calls.filter(call=>call[0]==='warning').length,1);
 assert.equal(calls.filter(call=>call[0]==='ban').length,1);
 assert.match(JSON.stringify(updates),/administrativeDecisions/);
});
test('warning acknowledgement is bound to the affected account and audit uses a separate persistent collection',async()=>{
 const calls=[];
 const db={collection:name=>({createIndex:async()=>{},findOneAndUpdate:async(query,update)=>{calls.push([name,query,update]);return {_id:'warning',reportProtocol:'RPT-ABCDEF123456'}},insertOne:async row=>calls.push([name,row])})};
 let response;
 await moderation.route({method:'POST',url:'/api/moderation/warnings/'+'a'.repeat(24)+'/acknowledge',headers:{}},{},'/api/moderation/warnings/'+'a'.repeat(24)+'/acknowledge',{sessionUser:async()=>({_id:'user',googleSub:'123'}),getDatabase:async()=>db,json:(_res,status,body)=>{response={status,body}},readJSON:async()=>({})});
 assert.equal(response.status,200);
 assert.equal(calls.some(([name,query])=>name==='user_warnings'&&query?.userId==='user'),true);
 assert.equal(calls.some(([name])=>name==='moderation_audit'),true);
});
test('an expired administrative lease is recoverable',async()=>{
 let query;
 const db={collection:()=>({findOneAndUpdate:async(value)=>{query=value;return {_id:'report'}}})};
 const claimed=await reports.acquireActionLease(db,'RPT-ABCDEF123456','admin');
 assert.equal(typeof claimed.leaseId,'string');
 assert.match(JSON.stringify(query),/leaseExpiresAt/);
 assert.match(JSON.stringify(query),/\$lte/);
});
test('post-removal journal resumes after a partial ImageKit failure without repeating pages',async()=>{
 let job;const collection={createIndex:async()=>{},findOneAndUpdate:async(_query,update)=>{if(!job)job={_id:'job',...update.$setOnInsert,...update.$set};else Object.assign(job,update.$set||{});return {...job,deletedFileIds:[...(job.deletedFileIds||[])]}},updateOne:async(_query,update)=>{if(update.$addToSet?.deletedFileIds&&!job.deletedFileIds.includes(update.$addToSet.deletedFileIds))job.deletedFileIds.push(update.$addToSet.deletedFileIds);if(update.$set)Object.assign(job,update.$set);if(update.$unset)for(const key of Object.keys(update.$unset))delete job[key];return {modifiedCount:1}}};
 const db={collection:()=>collection},report={protocol:'RPT-ABCDEF123456',targetType:'post',targetId:'a'.repeat(24),reportedAuthorId:'AEF-00000002'};
 const first=await removals.runPostRemoval(db,report,['cover','page-2'],{removeFile:async file=>{if(file==='page-2')throw Error('ImageKit indisponível')},finalize:async()=>{throw Error('não deve finalizar')}});
 assert.equal(first.state,'pending');assert.deepEqual(job.deletedFileIds,['cover']);
 const retried=[];let finalized=false;
 const second=await removals.runPostRemoval(db,report,['cover','page-2'],{removeFile:async file=>retried.push(file),finalize:async()=>{finalized=true}});
 assert.equal(second.state,'deleted');assert.deepEqual(retried,['page-2']);assert.equal(finalized,true);assert.equal(job.state,'completed');
});
test('a live external-removal lease prevents concurrent duplicate work',async()=>{
 const db={collection:()=>({createIndex:async()=>{},findOneAndUpdate:async()=>null})};
 const result=await removals.runPostRemoval(db,{protocol:'RPT-ABCDEF123456',targetType:'post',targetId:'a'.repeat(24),reportedAuthorId:'AEF-00000002'},['cover'],{removeFile:async()=>{throw Error('não deveria executar')},finalize:async()=>{}});
 assert.equal(result.state,'busy');
});
test('a lost report-action lease aborts before a second administrative mutation',async()=>{
 const db={collection:()=>({updateOne:async()=>({modifiedCount:0})})};
 await assert.rejects(()=>reports.renewActionLease(db,'report','lease'),/perdeu o bloqueio/);
});
test('an expired removal lease cannot be renewed, failed, or completed by its former owner',async()=>{
 const queries=[];const db={collection:()=>({updateOne:async query=>{queries.push(query);return {modifiedCount:0}}})};
 await assert.rejects(()=>removals.renew(db,'job','lease'),/perdeu o bloqueio/);
 assert.match(JSON.stringify(queries[0]),/leaseExpiresAt/);
 assert.match(JSON.stringify(queries[0]),/\$gt/);
});
test('lease loss during an external delete does not finalize or mark a stale operation complete',async()=>{
 let calls=0,finalized=false;
 const collection={createIndex:async()=>{},findOneAndUpdate:async()=>({_id:'job',files:['cover'],deletedFileIds:[],leaseId:'lease',state:'processing'}),updateOne:async()=>({modifiedCount:++calls===3?0:1})};
 const result=await removals.runPostRemoval({collection:()=>collection},{protocol:'RPT-ABCDEF123456',targetType:'post',targetId:'a'.repeat(24),reportedAuthorId:'AEF-00000002'},['cover'],{removeFile:async()=>({deleted:true}),finalize:async()=>{finalized=true}});
 assert.equal(result.state,'pending');assert.equal(finalized,false);
});
test('a missing ImageKit file is journaled as already absent and does not block the remaining pages',async()=>{
 let job;const collection={createIndex:async()=>{},findOneAndUpdate:async(_q,update)=>{job={_id:'job',...(job||update.$setOnInsert),...(update.$set||{})};return {...job,deletedFileIds:[...(job.deletedFileIds||[])]}},updateOne:async(_q,update)=>{if(update.$addToSet?.deletedFileIds)job.deletedFileIds.push(update.$addToSet.deletedFileIds);return {modifiedCount:1}}};
 const seen=[];const result=await removals.runPostRemoval({collection:()=>collection},{protocol:'RPT-ABCDEF123456',targetType:'post',targetId:'a'.repeat(24),reportedAuthorId:'AEF-00000002'},['cover','page-2'],{removeFile:async file=>{seen.push(file);return file==='cover'?{alreadyMissing:true}:{deleted:true}},finalize:async()=>{}});
 assert.equal(result.state,'deleted');assert.deepEqual(seen,['cover','page-2']);
});
