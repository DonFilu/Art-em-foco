'use strict';

const {avatarInfo}=require('./avatars');
const ARTIST_ID=/^AEF-\d{8,}$/;

function scorePipeline(artistId){
 const active=[
  {$lookup:{from:'art_posts',localField:'postId',foreignField:'_id',as:'post'}},
  {$unwind:'$post'},
  {$project:{artistId:'$post.authorId',likes:{$literal:1}}}
 ];
 return [
  ...active,
  {$unionWith:{coll:'deleted_post_likes',pipeline:[
   {$match:{likesReceived:{$gt:0}}},
   {$project:{artistId:'$authorId',likes:'$likesReceived'}}
  ]}},
  {$group:{_id:'$artistId',totalLikes:{$sum:'$likes'}}},
  {$lookup:{from:'users',localField:'_id',foreignField:'artId',as:'user'}},
  {$unwind:'$user'},
  ...(artistId?[{$match:{_id:artistId}}]:[])
 ];
}

function artist(user){
 return {id:user.artId,name:user.displayName||user.username||user.artId,username:user.username||user.artId.toLowerCase(),...avatarInfo(user)};
}

async function scores(db,artistId){
 return db.collection('post_likes').aggregate(scorePipeline(artistId)).toArray();
}

async function route(req,res,pathname,{sessionUser,getDatabase,json}){
 if(req.method!=='GET')return false;
 const top=pathname==='/api/ranking/top-artists';
 const prestige=pathname==='/api/ranking/prestige';
 const match=/^\/api\/ranking\/artists\/(AEF-\d{8,})$/.exec(pathname);
 if(!top&&!match&&!prestige)return false;
 try{
  const viewer=await sessionUser(req);
  if(!viewer)return json(res,401,{error:'Faça login para consultar o ranking'}),true;
  const db=await getDatabase();
  if(prestige){const rows=await scores(db);rows.sort((a,b)=>b.totalLikes-a.totalLikes||String(a._id).localeCompare(String(b._id)));const result=rows.slice(0,10).map((row,i)=>({id:row._id,rank:i+1}));if(result.length<10){const fillers=await db.collection('users').find({artId:{$nin:rows.map(r=>r._id)}},{projection:{artId:1}}).sort({artId:1}).limit(10-result.length).toArray();for(const u of fillers)result.push({id:u.artId,rank:result.length+1})}res.setHeader('Cache-Control','private, no-store');return json(res,200,{artists:result}),true;}
  if(match){
   const artistId=match[1];
   if(!ARTIST_ID.test(artistId))return json(res,400,{error:'Artista inválido'}),true;
   const user=await db.collection('users').findOne({artId:artistId},{projection:{artId:1,displayName:1,username:1,avatar:1,picture:1,avatarDiscord:1,avatarUpdatedAt:1}});
   if(!user)return json(res,404,{error:'Artista não encontrado'}),true;
   const [row]=await scores(db,artistId);
   return json(res,200,{artist:artist(user),totalLikes:row?.totalLikes||0}),true;
  }
  const rows=await scores(db);
  rows.sort((a,b)=>b.totalLikes-a.totalLikes||String(a._id).localeCompare(String(b._id)));
  if(rows.length&&rows[0].totalLikes>0)await require('./badges').markTop(db,rows[0]._id);
  const fillers=rows.length<10?await db.collection('users').find({artId:{$nin:rows.map(row=>row._id)}},{projection:{artId:1,displayName:1,username:1,avatar:1,picture:1,avatarDiscord:1,avatarUpdatedAt:1}}).sort({artId:1}).limit(10-rows.length).toArray():[];
  const topRows=[...rows,...fillers.map(user=>({_id:user.artId,totalLikes:0,user}))].slice(0,10);
  const viewerIndex=rows.findIndex(row=>row._id===viewer.artId),viewerRow=viewerIndex>=0?rows[viewerIndex]:null;
  const viewerPosition=viewerRow?viewerIndex+1:rows.length+await db.collection('users').countDocuments({artId:{$lte:viewer.artId}});
  return json(res,200,{artists:topRows.map((row,index)=>({...artist(row.user),totalLikes:row.totalLikes,position:index+1})),viewerPosition,viewerTotalLikes:viewerRow?.totalLikes||0}),true;
 }catch(error){
  console.error('Falha ao consultar ranking:',error.message);
  return json(res,503,{error:'Não foi possível carregar o ranking'}),true;
 }
}

module.exports={route,scorePipeline};
