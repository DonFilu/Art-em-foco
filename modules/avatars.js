'use strict';
const DEFAULT_AVATAR='/assets/logo/file_00000000b1bc820eb89e7b675b7b77fa.png';
function value(input){return typeof input==='string'&&input.trim()?input.trim():''}
function avatarInfo(user={}){
 const custom=value(user.avatar),updated=user.avatarUpdatedAt instanceof Date?user.avatarUpdatedAt.getTime():'';
 return {avatar:custom||DEFAULT_AVATAR,avatarFallback:custom?DEFAULT_AVATAR:'',avatarVersion:custom?String(user.avatarDiscord?.messageId||updated||''):''};
}
module.exports={avatarInfo,DEFAULT_AVATAR};
