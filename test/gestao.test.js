'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {test}=require('node:test');
const {parsePasswordHash,verifyPassword}=require('../modules/gestao');

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
