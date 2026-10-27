'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {test}=require('node:test');
const {parsePasswordHash,verifyPassword,accounts,accountFor,normalAndAdmin,requireAdmin}=require('../modules/gestao');

function makeHash(password){
 const salt=Buffer.from('0123456789abcdef');
 const hash=crypto.scryptSync(password,salt,32,{N:16384,r:8,p:1,maxmem:256*1024*1024});
 return 'scrypt$16384$8$1$'+salt.toString('base64url')+'$'+hash.toString('base64url');
}

test('accepts only a bounded scrypt password hash format',()=>{
 const valid=makeHash('senha-administrativa-segura');
 assert.equal(parsePasswordHash(valid)?.N,16384);
 assert.equal(parsePasswordHash('scrypt$1024$8$1$MDEyMzQ1Njc4OWFiY2RlZg$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),null);
 assert.equal(parsePasswordHash('argon2$anything'),null);
 assert.equal(parsePasswordHash(undefined),null);
});

test('verifies the administrative password with a constant-time hash comparison',async()=>{
 const hash=makeHash('senha-administrativa-segura');
 assert.equal(await verifyPassword('senha-administrativa-segura',hash),true);
 assert.equal(await verifyPassword('senha-administrativa-incorreta',hash),false);
 assert.equal(await verifyPassword('curta',hash),false);
});
test('maps each configured moderator to only its own Google ID and password hash',async()=>{
 const previous={owner:process.env.GESTAO_ADMIN_GOOGLE_ID,ownerHash:process.env.GESTAO_PASSWORD_HASH,mod1:process.env.GESTAO_MOD1_ID,mod1Hash:process.env.GESTAO_MOD1_PASSWORD_HASH,mod2:process.env.GESTAO_MOD2_ID,mod2Hash:process.env.GESTAO_MOD2_PASSWORD_HASH};
 try{process.env.GESTAO_ADMIN_GOOGLE_ID='100000000001';process.env.GESTAO_PASSWORD_HASH=makeHash('senha-proprietario-segura');process.env.GESTAO_MOD1_ID='100000000002';process.env.GESTAO_MOD1_PASSWORD_HASH=makeHash('senha-moderador-um');process.env.GESTAO_MOD2_ID='100000000001';process.env.GESTAO_MOD2_PASSWORD_HASH=makeHash('senha-duplicada-invalida');const configured=accounts();assert.equal(configured.owner.role,'owner');assert.equal(configured.moderators.length,1);assert.equal(accountFor('100000000002').role,'moderator');assert.equal(await verifyPassword('senha-moderador-um',accountFor('100000000002').passwordHash),true);assert.equal(await verifyPassword('senha-proprietario-segura',accountFor('100000000002').passwordHash),false)}finally{for(const [key,value] of Object.entries({GESTAO_ADMIN_GOOGLE_ID:previous.owner,GESTAO_PASSWORD_HASH:previous.ownerHash,GESTAO_MOD1_ID:previous.mod1,GESTAO_MOD1_PASSWORD_HASH:previous.mod1Hash,GESTAO_MOD2_ID:previous.mod2,GESTAO_MOD2_PASSWORD_HASH:previous.mod2Hash})){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
test('a moderator session cannot become an owner session and is revoked after credential change',async()=>{
 const old={id:process.env.GESTAO_ADMIN_GOOGLE_ID,hash:process.env.GESTAO_PASSWORD_HASH,mod:process.env.GESTAO_MOD1_ID,modHash:process.env.GESTAO_MOD1_PASSWORD_HASH};
 try{process.env.GESTAO_ADMIN_GOOGLE_ID='100000000011';process.env.GESTAO_PASSWORD_HASH=makeHash('senha-proprietario-segura');process.env.GESTAO_MOD1_ID='100000000012';process.env.GESTAO_MOD1_PASSWORD_HASH=makeHash('senha-moderador-um');const account=accountFor('100000000012'),token='a'.repeat(64),version=account.credentialVersion;let query;const db={collection:()=>({findOne:async value=>{query=value;return value.credentialVersion===version?{role:'moderator',credentialVersion:version}:null}})};const user={_id:'user',googleSub:'100000000012'};const admin=await normalAndAdmin({headers:{cookie:'cidio_gestao_session='+token}},db,async()=>user);assert.equal(admin.role,'moderator');assert.equal(query.role,'moderator');process.env.GESTAO_MOD1_PASSWORD_HASH=makeHash('senha-moderador-nova');const revoked=await normalAndAdmin({headers:{cookie:'cidio_gestao_session='+token}},db,async()=>user);assert.equal(revoked,null)}finally{for(const [key,value] of Object.entries({GESTAO_ADMIN_GOOGLE_ID:old.id,GESTAO_PASSWORD_HASH:old.hash,GESTAO_MOD1_ID:old.mod,GESTAO_MOD1_PASSWORD_HASH:old.modHash})){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
test('owner-only APIs reject a valid moderator session on the backend',async()=>{
 const old={id:process.env.GESTAO_ADMIN_GOOGLE_ID,hash:process.env.GESTAO_PASSWORD_HASH,mod:process.env.GESTAO_MOD1_ID,modHash:process.env.GESTAO_MOD1_PASSWORD_HASH};
 try{process.env.GESTAO_ADMIN_GOOGLE_ID='100000000021';process.env.GESTAO_PASSWORD_HASH=makeHash('senha-proprietario-segura');process.env.GESTAO_MOD1_ID='100000000022';process.env.GESTAO_MOD1_PASSWORD_HASH=makeHash('senha-moderador-um');const account=accountFor('100000000022'),token='b'.repeat(64);let response;const db={collection:()=>({findOne:async()=>({role:'moderator',credentialVersion:account.credentialVersion})})};const result=await requireAdmin({headers:{cookie:'cidio_gestao_session='+token}}, {},db,async()=>({_id:'moderator',googleSub:'100000000022'}),(_res,status,body)=>{response={status,body}},{roles:['owner']});assert.equal(result,null);assert.equal(response.status,403)}finally{for(const [key,value] of Object.entries({GESTAO_ADMIN_GOOGLE_ID:old.id,GESTAO_PASSWORD_HASH:old.hash,GESTAO_MOD1_ID:old.mod,GESTAO_MOD1_PASSWORD_HASH:old.modHash})){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});

// Regression: moderators must never delete reports through the API.
test('moderator cannot delete reports even by direct API request',async()=>{
 const {route}=require('../modules/denuncias');
 const previous={owner:process.env.GESTAO_ADMIN_GOOGLE_ID,ownerHash:process.env.GESTAO_PASSWORD_HASH,mod:process.env.GESTAO_MOD1_ID,modHash:process.env.GESTAO_MOD1_PASSWORD_HASH};
 try{
  process.env.GESTAO_ADMIN_GOOGLE_ID='100000000031';process.env.GESTAO_PASSWORD_HASH=makeHash('senha-proprietario-segura');
  process.env.GESTAO_MOD1_ID='100000000032';process.env.GESTAO_MOD1_PASSWORD_HASH=makeHash('senha-moderador-um');
  const account=accountFor('100000000032'),csrfToken='test-csrf-token';
  const db={collection:()=>({createIndex:async()=>{},findOne:async()=>({csrfToken,role:'moderator',credentialVersion:account.credentialVersion})})};
  let response,readBody=false;
  const handled=await route({method:'DELETE',url:'/api/gestao/denuncias/RPT-ABCDEF123456',headers:{cookie:'cidio_gestao_session='+('a'.repeat(64)),'x-gestao-csrf':csrfToken}}, {},'/api/gestao/denuncias/RPT-ABCDEF123456',{
   sessionUser:async()=>({_id:'moderator',googleSub:'100000000032'}),getDatabase:async()=>db,
   json:(_res,status,body)=>{response={status,body}},readJSON:async()=>{readBody=true;return {confirm:true}},
   gestao:require('../modules/gestao')
  });
  assert.equal(handled,true);assert.equal(response.status,403);assert.equal(readBody,false);
 }finally{
  for(const [key,value] of Object.entries({GESTAO_ADMIN_GOOGLE_ID:previous.owner,GESTAO_PASSWORD_HASH:previous.ownerHash,GESTAO_MOD1_ID:previous.mod,GESTAO_MOD1_PASSWORD_HASH:previous.modHash})){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});
