'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const {scorePipeline,donorTotalsPipeline,generalPipeline,generalPointTenths}=require('../modules/ranking');

test('the ranking score combines active and historic deleted likes without client input',()=>{
 const pipeline=scorePipeline();
 const deleted=pipeline.find(stage=>stage.$unionWith).$unionWith.pipeline;
 assert.equal(deleted[0].$match.likesReceived.$gt,0);
 assert.ok(pipeline.some(stage=>stage.$group?.totalLikes));
});

test('the profile score uses the same pipeline and restricts its artist after aggregation',()=>{
 const pipeline=scorePipeline('AEF-00000042');
 assert.deepEqual(pipeline.at(-1),{$match:{_id:'AEF-00000042'}});
 assert.ok(pipeline.some(stage=>stage.$group?.totalLikes));
});

test('the ranking page and home shortcut use the authenticated server endpoints',()=>{
 const client=fs.readFileSync('js/ranking.js','utf8');
 const page=fs.readFileSync('ranking.html','utf8');
 assert.match(client,/api\/ranking\/top-artists/);
 assert.match(client,/hubRanking/);
 assert.match(page,/id="rankingList"/);
});

test('donor and general rankings use net confirmed cents only and preserve deterministic integer scoring',()=>{
 const donors=donorTotalsPipeline(),general=generalPipeline(),donorMatch=donors[0].$match;
 assert.deepEqual(donorMatch.status.$in,['paid','partially_refunded']);
 assert.equal(donorMatch.netAmountCents.$gt,0);
 assert.ok(general.some(stage=>stage.$unionWith?.coll==='donation_payments'));
 assert.ok(general.some(stage=>stage.$group?.totalDonationCents));
 assert.equal(generalPointTenths(100,0),1000);
 assert.equal(generalPointTenths(100,1000),2000);
 assert.equal(generalPointTenths(500,5000),10000);
});

test('ranking tabs and donor auras are separate from existing likes styling',()=>{
 const page=fs.readFileSync('ranking.html','utf8'),client=fs.readFileSync('js/ranking.js','utf8'),prestige=fs.readFileSync('js/prestige.js','utf8'),css=fs.readFileSync('css/prestige.css','utf8');
 assert.match(page,/rankingDonorsTab/);assert.match(page,/rankingGeneralTab/);
 assert.match(client,/api\/ranking\/donors/);assert.match(client,/api\/ranking\/general/);
 assert.match(prestige,/api\/ranking\/auras/);assert.match(css,/cidio-donor-diamond/);
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/cidio-donor-arcane/);
});
