'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {avatarInfo,DEFAULT_AVATAR}=require('../modules/avatars');

test('prefers the custom Art em Foco avatar and retains the visual default as fallback',()=>{
 assert.deepEqual(avatarInfo({avatar:'/api/profile/image/AEF-00000001/avatar',picture:'https://google.example/photo',avatarDiscord:{messageId:'42'}}),{avatar:'/api/profile/image/AEF-00000001/avatar',avatarFallback:DEFAULT_AVATAR,avatarVersion:'42'});
});
test('uses the Art em Foco visual default when no custom avatar exists',()=>{
 assert.deepEqual(avatarInfo({picture:'https://google.example/photo'}),{avatar:DEFAULT_AVATAR,avatarFallback:'',avatarVersion:''});
});
test('returns the visual default avatar when no image is available',()=>{
 assert.deepEqual(avatarInfo({}),{avatar:DEFAULT_AVATAR,avatarFallback:'',avatarVersion:''});
});
