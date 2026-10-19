'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {cleanText,cleanColor,cleanLink}=require('../modules/stories');
test('validates text Stories without HTML execution',()=>{assert.equal(cleanText(' <b>texto</b> '),'<b>texto</b>');assert.throws(()=>cleanText(''))});
test('restricts colors and HTTPS external links',()=>{assert.equal(cleanColor('#123abc'),'#123abc');assert.equal(cleanColor('red'),'#403643');assert.equal(cleanLink('https://example.com/a'),'https://example.com/a');assert.throws(()=>cleanLink('javascript:alert(1)'));assert.throws(()=>cleanLink('http://example.com'))});
