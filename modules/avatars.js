'use strict';

function value(input){return typeof input==='string'&&input.trim()?input.trim():''}
function avatarInfo(user={}){
 const custom=value(user.avatar),google=value(user.picture),updated=user.avatarUpdatedAt instanceof Date?user.avatarUpdatedAt.getTime():'';
 return {avatar:custom||google,avatarFallback:custom&&google?google:'',avatarVersion:custom?String(user.avatarDiscord?.messageId||updated||''):''};
}

module.exports={avatarInfo};
