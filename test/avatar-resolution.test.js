'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {avatarInfo}=require('../modules/avatars');

test('prefers the custom Art em Foco avatar and retains Google as fallback',()=>{
 assert.deepEqual(avatarInfo({avatar:'/api/profile/image/AEF-00000001/avatar',picture:'https://google.example/photo',avatarDiscord:{messageId:'42'}}),{avatar:'/api/profile/image/AEF-00000001/avatar',avatarFallback:'https://google.example/photo',avatarVersion:'42'});
});
test('uses Google picture when no custom avatar exists',()=>{
 assert.deepEqual(avatarInfo({picture:'https://google.example/photo'}),{avatar:'https://google.example/photo',avatarFallback:'',avatarVersion:''});
});
test('returns an empty image source for the visual default avatar',()=>{
 assert.deepEqual(avatarInfo({}),{avatar:'',avatarFallback:'',avatarVersion:''});
});
