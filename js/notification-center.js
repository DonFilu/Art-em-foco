(()=>{'use strict';
 if(window.ArtEmFocoNotifications)return;
 const listeners=new Set();
 const state={viewerId:null,notifications:[],unreadCount:0,soundEnabled:true,ready:false,signedOut:false};
 let knownEvents=new Set(),timer,sessionSummary=null,latestRequest=0,pendingLoginViewerId=null;
 const reminderMemory=new Map();
 const REMINDER_INTERVAL=2*60*60*1000;
 const validId=value=>typeof value==='string'&&/^[0-9a-f]{24}$/.test(value);
 function normalize(items){
  if(!Array.isArray(items))return [];
  return items.filter(item=>validId(item?.id)&&Number.isFinite(Date.parse(item.createdAt))).map(item=>({...item,eventKey:item.id+':'+new Date(item.createdAt).toISOString()}));
 }
 function publish(type,notifications=[],details={}){for(const listener of listeners)listener({type,notifications,state:{...state,notifications:[...state.notifications]},...details})}
 function reminderKey(viewerId){return 'aef-notification-reminder:'+viewerId}
 function loginKey(viewerId){return 'aef-notification-new-login:'+viewerId}
 function consumeNewLogin(viewerId){if(pendingLoginViewerId===viewerId){pendingLoginViewerId=null;try{sessionStorage.removeItem(loginKey(viewerId))}catch{}return true}try{if(sessionStorage.getItem(loginKey(viewerId))!=='1')return false;sessionStorage.removeItem(loginKey(viewerId));return true}catch{return false}}
 function claimReminder(viewerId,fromNewLogin){const now=Date.now();let last=reminderMemory.get(viewerId)||0;try{last=Math.max(last,Number(localStorage.getItem(reminderKey(viewerId)))||0)}catch{}if(!fromNewLogin&&now-last<REMINDER_INTERVAL)return false;reminderMemory.set(viewerId,now);try{localStorage.setItem(reminderKey(viewerId),String(now))}catch{}return true}
 function reset(type,details={}){state.viewerId=null;state.notifications=[];state.unreadCount=0;state.ready=false;knownEvents.clear();sessionSummary=null;publish(type,[],details)}
 function clear(){latestRequest++;const viewerId=state.viewerId||pendingLoginViewerId;pendingLoginViewerId=null;try{if(viewerId)sessionStorage.removeItem(loginKey(viewerId))}catch{}state.signedOut=true;reset('signed-out')}
 async function refresh(force=false){
  if(document.hidden||(!force&&state.signedOut))return;
  const request=++latestRequest;
  try{
   const response=await fetch('/api/notifications',{credentials:'same-origin',cache:'no-store'});
   if(request!==latestRequest)return;
   if(response.status===401){clear();return}
   if(!response.ok)return;
   const data=await response.json();
   if(request!==latestRequest)return;
   if(typeof data.viewerId!=='string'||!data.viewerId)return;
   const notifications=normalize(data.notifications),changedAccount=state.viewerId&&state.viewerId!==data.viewerId;
   if(changedAccount){const previousViewerId=state.viewerId;if(pendingLoginViewerId&&pendingLoginViewerId!==data.viewerId)pendingLoginViewerId=null;reset('account-change',{previousViewerId,viewerId:data.viewerId})}
   const firstLoad=!state.ready;
   const previous=knownEvents;
   if(firstLoad){knownEvents=new Set(notifications.map(item=>item.eventKey));state.viewerId=data.viewerId;state.ready=true;state.signedOut=false;sessionSummary=null}
   else knownEvents=new Set(notifications.map(item=>item.eventKey));
   state.notifications=notifications;state.unreadCount=notifications.filter(item=>!item.readAt).length;state.soundEnabled=data.soundEnabled!==false;
   publish('state');
   const arrived=firstLoad?[]:notifications.filter(item=>!previous.has(item.eventKey));
   const fromNewLogin=consumeNewLogin(data.viewerId);
   if(state.unreadCount&&!arrived.length&&claimReminder(data.viewerId,fromNewLogin)){sessionSummary={kind:'summary',count:state.unreadCount,eventKey:'summary:'+data.viewerId+':'+Date.now()};publish('summary',[sessionSummary])}
   if(firstLoad)return;
   if(arrived.length)publish('new',arrived);
  }catch{/* Keep the last known state on transient network failures. */}
 }
 function start(){if(timer)return;refresh(true);timer=setInterval(refresh,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});window.addEventListener('artemfoco:authenticated',event=>{const viewerId=event.detail?.id;if(event.detail?.notificationLogin===true&&typeof viewerId==='string')pendingLoginViewerId=viewerId;latestRequest++;if(typeof viewerId==='string'&&viewerId&&state.viewerId&&state.viewerId!==viewerId){const previousViewerId=state.viewerId;reset('account-change',{previousViewerId,viewerId})}state.signedOut=false;refresh(true)});window.addEventListener('artemfoco:logout',clear)}
 window.ArtEmFocoNotifications={subscribe(listener){listeners.add(listener);if(state.ready||state.signedOut)listener({type:'state',notifications:[],state:{...state,notifications:[...state.notifications]}});if(sessionSummary)listener({type:'summary',notifications:[sessionSummary],state:{...state,notifications:[...state.notifications]}});return()=>listeners.delete(listener)},refresh};
 start();
})();
