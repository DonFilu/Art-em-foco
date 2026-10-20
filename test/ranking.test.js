'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const {scorePipeline}=require('../modules/ranking');

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
