'use strict';
const {scorePipeline}=require('./ranking');
const BADGES=[
{id:'dev',name:'Dev',icon:'⌘',special:true},
{id:'moderator',name:'Moderador',icon:'🛡️',special:true},
{id:'beginner',name:'Artista iniciante',icon:'🌱',type:'posts',target:1},
{id:'rising',name:'Artista início da fama',icon:'✨',type:'likes',target:100},
{id:'famous',name:'Artista famoso',icon:'⭐',type:'likes',target:5000},
{id:'peak',name:'Artista no auge',icon:'🔥',type:'likes',target:10000},
{id:'top',name:'Artista top',icon:'🏆',special:true},
{id:'artist_influencer',name:'Artista influencer',icon:'📣',type:'likes',target:50000},
{id:'legendary',name:'Artista lendário',icon:'👑',type:'both',target:100000,postsTarget:300},
{id:'influencer',name:'Influencer',icon:'📡',special:true}
];
function ids(name){return new Set(String(process.env[name]||'').split(/[;,\s]+/).map(s=>s.trim()).filter(Boolean))}
async function snapshot(db,id){
 const [likes]=await db.collection('post_likes').aggregate(scorePipeline(id)).toArray();
 const [posts,deleted]=await Promise.all([
 db.collection('art_posts').countDocuments({authorId:id}),
 db.collection('deleted_post_likes').countDocuments({authorId:id})
 ]);
 return {likes:likes?.totalLikes||0,posts,deleted};
}
async function calculate(db,id){
 const user=await db.collection('users').findOne({artId:id},{projection:{artId:1,badgesUnlocked:1,badgeMaxLikes:1,badgeMaxPosts:1,badgeDeletedPosts:1}});
 if(!user)return null;
 const stats=await snapshot(db,id);
 const maxLikes=Math.max(stats.likes,user.badgeMaxLikes||0);
 stats.posts+=Math.max(stats.deleted,user.badgeDeletedPosts||0);
 const maxPosts=Math.max(stats.posts,user.badgeMaxPosts||0);
 const unlocked=new Set(user.badgesUnlocked||[]);
 const privileged={dev:ids('CIDIO_ART_DEV_IDS').has(id),moderator:ids('CIDIO_ART_MODERATOR_IDS').has(id),influencer:ids('CIDIO_ART_INFLUENCER_IDS').has(id)};
 for(const b of BADGES){
 if(b.type==='likes'&&maxLikes>=b.target||b.type==='posts'&&maxPosts>=b.target||b.type==='both'&&maxLikes>=b.target&&maxPosts>=b.postsTarget)unlocked.add(b.id);
 }
 if(maxLikes!==user.badgeMaxLikes||maxPosts!==user.badgeMaxPosts||unlocked.size!==(user.badgesUnlocked||[]).length){
 await db.collection('users').updateOne({artId:id},{$set:{badgeMaxLikes:maxLikes,badgeMaxPosts:maxPosts,badgesUnlocked:[...unlocked]}});
 }
 return {stats:{likes:stats.likes,posts:stats.posts},badges:BADGES.map(b=>({...b,unlocked:b.special?(b.id==='top'?unlocked.has('top'):!!privileged[b.id]):unlocked.has(b.id),current:b.type==='posts'?stats.posts:stats.likes,postsCurrent:stats.posts}))};
}
async function markTop(db,id){if(id)await db.collection('users').updateOne({artId:id},{$addToSet:{badgesUnlocked:'top'}})}
async function route(req,res,pathname,{sessionUser,getDatabase,json}){
 if(pathname!=='/api/badges')return false;
 if(req.method!=='GET'){json(res,405,{error:'Método não permitido'});return true}
 try{const viewer=await sessionUser(req);if(!viewer){json(res,401,{error:'Entre na sua conta'});return true}
 const id=new URL(req.url,'http://localhost').searchParams.get('id')||viewer.artId;
 if(!/^AEF-\d{8,}$/.test(id)){json(res,400,{error:'ID inválido'});return true}
 const result=await calculate(await getDatabase(),id);
 json(res,result?200:404,result||{error:'Artista não encontrado'});
 }catch(e){console.error('Insígnias:',e);json(res,503,{error:'Não foi possível carregar insígnias'})}
 return true;
}
module.exports={route,calculate,markTop};
