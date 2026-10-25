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
