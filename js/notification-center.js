(()=>{'use strict';
 if(window.ArtEmFocoNotifications)return;
 const listeners=new Set();
 const state={viewerId:null,notifications:[],unreadCount:0,soundEnabled:true,ready:false,signedOut:false};
 let knownEvents=new Set(),timer,sessionSummary=null,latestRequest=0;
 const validId=value=>typeof value==='string'&&/^[0-9a-f]{24}$/.test(value);
 function normalize(items){
  if(!Array.isArray(items))return [];
  return items.filter(item=>validId(item?.id)&&Number.isFinite(Date.parse(item.createdAt))).map(item=>({...item,eventKey:item.id+':'+new Date(item.createdAt).toISOString()}));
 }
 function publish(type,notifications=[],details={}){for(const listener of listeners)listener({type,notifications,state:{...state,notifications:[...state.notifications]},...details})}
 function summaryKey(viewerId){return 'aef-notification-summary:'+viewerId}
 function hasSeenSummary(viewerId){try{return sessionStorage.getItem(summaryKey(viewerId))==='1'}catch{return true}}
 function markSummarySeen(viewerId){try{sessionStorage.setItem(summaryKey(viewerId),'1')}catch{}}
 function clear(){state.viewerId=null;state.notifications=[];state.unreadCount=0;state.ready=false;state.signedOut=true;knownEvents.clear();sessionSummary=null;publish('signed-out')}
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
   if(changedAccount){const previousViewerId=state.viewerId;state.viewerId=null;state.notifications=[];state.unreadCount=0;state.ready=false;knownEvents.clear();sessionSummary=null;publish('account-change',[],{previousViewerId,viewerId:data.viewerId})}
   const firstLoad=!state.ready;
   const previous=knownEvents;
   if(firstLoad){knownEvents=new Set(notifications.map(item=>item.eventKey));state.viewerId=data.viewerId;state.ready=true;state.signedOut=false;sessionSummary=null}
   else knownEvents=new Set(notifications.map(item=>item.eventKey));
   state.notifications=notifications;state.unreadCount=notifications.filter(item=>!item.readAt).length;state.soundEnabled=data.soundEnabled!==false;
   publish('state');
   if(firstLoad){
    if(state.unreadCount&&!hasSeenSummary(data.viewerId)){markSummarySeen(data.viewerId);sessionSummary={kind:'summary',count:state.unreadCount,eventKey:'summary:'+data.viewerId};publish('summary',[sessionSummary])}
    return;
   }
   const arrived=notifications.filter(item=>!previous.has(item.eventKey));
   if(arrived.length)publish('new',arrived);
  }catch{/* Keep the last known state on transient network failures. */}
 }
 function start(){if(timer)return;refresh(true);timer=setInterval(refresh,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});window.addEventListener('artemfoco:authenticated',()=>{state.signedOut=false;refresh(true)})}
 window.ArtEmFocoNotifications={subscribe(listener){listeners.add(listener);if(state.ready||state.signedOut)listener({type:'state',notifications:[],state:{...state,notifications:[...state.notifications]}});if(sessionSummary)listener({type:'summary',notifications:[sessionSummary],state:{...state,notifications:[...state.notifications]}});return()=>listeners.delete(listener)},refresh};
 start();
})();
