'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const reports=require('../modules/denuncias');
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
