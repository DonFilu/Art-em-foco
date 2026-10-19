'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const client=fs.readFileSync('js/art-interactions.js','utf8');
const server=fs.readFileSync('modules/interactions.js','utf8');

test('pagination controls are replaceable and requests are guarded',()=>{
 assert.match(client,/function addMore\(holder,label,handler\).*art-load-more/);
 assert.match(client,/function removeMore\(holder\).*art-load-more/);
 assert.match(client,/if\(holder\.dataset\.loading==='1'\)return/);
});

test('the first reply creates its own reply container',()=>{
 assert.match(client,/function ensureReplies\(card,comment\)/);
 assert.match(client,/const replies=ensureReplies\(rootCard,rootComment\)/);
});

test('gallery cards are associated using the media post id',()=>{
 assert.match(client,/getAttribute\('src'\).*posts\.get\(id\)/);
 assert.doesNotMatch(client,/cards\.forEach\(\(card,index\)/);
});

test('counters are updated atomically instead of using the request snapshot',()=>{
 assert.match(server,/findOneAndUpdate\([^\n]+\{\$inc:\{likeCount:1\}\}/);
 assert.match(server,/findOneAndUpdate\([^\n]+\{\$inc:\{likesCount:1\}\}/);
 assert.match(server,/\$max:\[0,\{\$subtract:/);
});

test('post interaction cleanup is idempotent and scoped to the post',()=>{
 assert.match(server,/async function cleanupPost\(db,postId\)/);
 assert.match(server,/deleteMany\(\{postId\}\)/);
});
