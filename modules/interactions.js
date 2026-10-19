'use strict';
const {ObjectId}=require('mongodb');
const {avatarInfo}=require('./avatars');
const MESSAGE_MAX=2000, PAGE_SIZE=20;
const recentComments=new Map();
let indexesReady;
const validId=id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id);
const asId=id=>new ObjectId(id);
function limit(value){return Math.max(1,Math.min(PAGE_SIZE,Number(value)||PAGE_SIZE))}
function text(value){if(typeof value!=='string')throw Error('Comentário inválido');const clean=value.trim();if(!clean||clean.length>MESSAGE_MAX)throw Error('Escreva uma mensagem de 1 a 2000 caracteres');return clean}
async function postFor(db,id,user,canViewArt){if(!validId(id))return null;const post=await db.collection('art_posts').findOne({_id:asId(id)});if(!post||!await canViewArt(db,post,user))return null;return post}
async function authorMap(db,rows){const ids=[...new Set(rows.map(row=>row.authorId))];const users=ids.length?await db.collection('users').find({artId:{$in:ids}},{projection:{artId:1,displayName:1,username:1,avatar:1,picture:1,avatarDiscord:1,avatarUpdatedAt:1}}).toArray():[];return new Map(users.map(u=>[u.artId,{id:u.artId,name:u.displayName||u.username||u.artId,username:u.username||u.artId.toLowerCase(),...avatarInfo(u)}]))}
async function serializeComments(db,rows,user){const authors=await authorMap(db,rows);const replyIds=[...new Set(rows.map(row=>row.replyToName).filter(value=>typeof value==='string'&&/^AEF-\d{8,}$/.test(value)))];const replyUsers=replyIds.length?await db.collection('users').find({artId:{$in:replyIds}},{projection:{artId:1,username:1,displayName:1}}).toArray():[];const replyNames=new Map(replyUsers.map(u=>[u.artId,u.username||u.displayName||u.artId]));let liked=new Set();if(user&&rows.length){const likes=await db.collection('comment_likes').find({userId:user._id,commentId:{$in:rows.map(r=>r._id)}},{projection:{commentId:1}}).toArray();liked=new Set(likes.map(l=>String(l.commentId)))}return rows.map(row=>({id:String(row._id),postId:String(row.postId),parentId:row.parentId?String(row.parentId):null,replyToId:row.replyToId?String(row.replyToId):null,replyToName:replyNames.get(row.replyToName)||row.replyToName||null,text:row.text,createdAt:row.createdAt,likesCount:row.likesCount||0,repliesCount:row.repliesCount||0,likedByViewer:liked.has(String(row._id)),author:authors.get(row.authorId)||{id:row.authorId,name:row.authorId,username:row.authorId.toLowerCase(),avatar:''}}))}
function cursorQuery(cursor){return validId(cursor)?{_id:{$lt:asId(cursor)}}:{}}
async function listComments(db,post,user,params,parentId=null){const query={postId:post._id,parentId,...cursorQuery(params.get('cursor'))};const rows=await db.collection('art_comments').find(query,{projection:{postId:1,parentId:1,replyToId:1,replyToName:1,authorId:1,text:1,createdAt:1,likesCount:1,repliesCount:1}}).sort({_id:-1}).limit(limit(params.get('limit'))+1).toArray();const more=rows.length>limit(params.get('limit'));if(more)rows.pop();return {comments:await serializeComments(db,rows,user),nextCursor:more?String(rows.at(-1)._id):null}}
function tooFast(user,postId){const key=user.artId+':'+postId,now=Date.now(),last=recentComments.get(key)||0;if(now-last<900)return true;recentComments.set(key,now);if(recentComments.size>5000){for(const [entry,time] of recentComments){if(now-time>=900)recentComments.delete(entry)}while(recentComments.size>5000)recentComments.delete(recentComments.keys().next().value)}return false}
async function sendInteraction(db,notifications,recipientArtId,actor,kind,post,commentId){if(!recipientArtId||recipientArtId===actor.artId)return;const recipient=await db.collection('users').findOne({artId:recipientArtId},{projection:{_id:1}});if(recipient)await notifications.interaction(db,{recipient,actor,kind,postId:String(post._id),postAuthorId:post.authorId,commentId});}
async function postLikesCount(db,postId){return db.collection('art_posts').findOne({_id:postId},{projection:{likeCount:1}}).then(row=>row?.likeCount||0)}
async function commentLikesCount(db,commentId){return db.collection('art_comments').findOne({_id:commentId},{projection:{likesCount:1}}).then(row=>row?.likesCount||0)}
async function commentsCount(db,postId){return db.collection('art_posts').findOne({_id:postId},{projection:{commentCount:1}}).then(row=>row?.commentCount||0)}
async function repliesCount(db,parentId){return db.collection('art_comments').findOne({_id:parentId},{projection:{repliesCount:1}}).then(row=>row?.repliesCount||0)}
/* Idempotent: a retry after a partial failure only removes remaining records for this post. */
async function cleanupPost(db,postId){const comments=await db.collection('art_comments').find({postId},{projection:{_id:1}}).toArray(),ids=comments.map(c=>c._id);if(ids.length)await db.collection('comment_likes').deleteMany({commentId:{$in:ids}});await db.collection('art_comments').deleteMany({postId});await db.collection('post_likes').deleteMany({postId})}
async function route(req,res,pathname,{sessionUser,getDatabase,json,canViewArt,notifications,ensureIndexes}){
 const match=/^\/api\/art\/posts\/([a-f0-9]{24})(?:\/(like)|\/(comments)(?:\/([a-f0-9]{24})(?:\/(replies|like))?)?)?$/.exec(pathname);
 if(!match)return false;
 const [,postId,postLike,commentsAction,commentId,commentAction]=match,postAction=postLike||commentsAction;
 try{
  const user=await sessionUser(req),db=await getDatabase(),params=new URL(req.url,'http://localhost').searchParams;if(!indexesReady)indexesReady=ensureIndexes(db).catch(error=>{indexesReady=null;throw error});await indexesReady;
  const post=await postFor(db,postId,user,canViewArt);if(!post){json(res,404,{error:'Publicação não encontrada ou sem acesso'});return true}
  const requireUser=()=>{if(!user){json(res,401,{error:'Entre com Google para interagir'});return false}return true};
  if(!postAction){json(res,405,{error:'Método não permitido'});return true}
  if(postAction==='like'){
   if(!requireUser())return true;
   const likes=db.collection('post_likes');
   if(req.method==='PUT'){
    try{await likes.insertOne({postId:post._id,userId:user._id,createdAt:new Date()});const updated=await db.collection('art_posts').findOneAndUpdate({_id:post._id},{$inc:{likeCount:1}},{returnDocument:'after',projection:{likeCount:1}});await sendInteraction(db,notifications,post.authorId,user,'postLike',post);json(res,201,{liked:true,likesCount:updated?.likeCount??await postLikesCount(db,post._id)})}catch(e){if(e.code===11000){json(res,200,{liked:true,likesCount:await postLikesCount(db,post._id)})}else throw e}return true;
   }
   if(req.method==='DELETE'){const deleted=await likes.deleteOne({postId:post._id,userId:user._id});let likesCount;if(deleted.deletedCount){const updated=await db.collection('art_posts').findOneAndUpdate({_id:post._id},[{$set:{likeCount:{$max:[0,{$subtract:[{$ifNull:['$likeCount',0]},1]}]}}}],{returnDocument:'after',projection:{likeCount:1}});likesCount=updated?.likeCount??await postLikesCount(db,post._id)}else likesCount=await postLikesCount(db,post._id);json(res,200,{liked:false,likesCount});return true}
   json(res,405,{error:'Método não permitido'});return true;
  }
  if(postAction!=='comments'){json(res,404,{error:'Rota inválida'});return true}
  if(!commentId){
   if(req.method==='GET'){json(res,200,await listComments(db,post,user,params));return true}
   if(req.method!=='POST'){json(res,405,{error:'Método não permitido'});return true}
   if(!requireUser())return true;if(tooFast(user,postId)){json(res,429,{error:'Aguarde um instante antes de enviar outro comentário'});return true}
   const data=await (async()=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)throw Error('Requisição muito grande')}return JSON.parse(body)})();
   const message=text(data.text);let parentId=null,replyToId=null,replyToName=null,recipient=post.authorId;
   if(data.parentId){if(!validId(data.parentId))throw Error('Comentário inválido');const parent=await db.collection('art_comments').findOne({_id:asId(data.parentId),postId:post._id,parentId:null});if(!parent)throw Error('Comentário original não encontrado');parentId=parent._id;recipient=parent.authorId;if(data.replyToId){if(!validId(data.replyToId))throw Error('Resposta inválida');const reply=await db.collection('art_comments').findOne({_id:asId(data.replyToId),postId:post._id,$or:[{_id:parent._id},{parentId:parent._id}]});if(!reply)throw Error('Resposta não encontrada');replyToId=reply._id;const replyUser=await db.collection('users').findOne({artId:reply.authorId},{projection:{username:1,displayName:1}});replyToName=replyUser?.username||replyUser?.displayName||reply.authorId;recipient=reply.authorId}}
   const now=new Date(),doc={postId:post._id,parentId,replyToId,replyToName,authorId:user.artId,text:message,createdAt:now,likesCount:0,repliesCount:0};const result=await db.collection('art_comments').insertOne(doc);const updatedPost=await db.collection('art_posts').findOneAndUpdate({_id:post._id},{$inc:{commentCount:1}},{returnDocument:'after',projection:{commentCount:1}});let updatedParent=null;if(parentId)updatedParent=await db.collection('art_comments').findOneAndUpdate({_id:parentId},{$inc:{repliesCount:1}},{returnDocument:'after',projection:{repliesCount:1}});await sendInteraction(db,notifications,recipient,user,parentId?'reply':'comment',post,String(result.insertedId));json(res,201,{comment:(await serializeComments(db,[{...doc,_id:result.insertedId}],user))[0],commentCount:updatedPost?.commentCount??await commentsCount(db,post._id),repliesCount:parentId?(updatedParent?.repliesCount??await repliesCount(db,parentId)):null});return true;
  }
  const comment=await db.collection('art_comments').findOne({_id:asId(commentId),postId:post._id});if(!comment){json(res,404,{error:'Comentário não encontrado'});return true}
  if(commentAction==='replies'){
   if(req.method!=='GET'){json(res,405,{error:'Método não permitido'});return true}if(comment.parentId){json(res,400,{error:'Respostas pertencem ao comentário principal'});return true}json(res,200,await listComments(db,post,user,params,comment._id));return true;
  }
  if(commentAction==='like'){
   if(!requireUser())return true;const likes=db.collection('comment_likes');
   if(req.method==='PUT'){try{await likes.insertOne({commentId:comment._id,userId:user._id,createdAt:new Date()});const updated=await db.collection('art_comments').findOneAndUpdate({_id:comment._id},{$inc:{likesCount:1}},{returnDocument:'after',projection:{likesCount:1}});await sendInteraction(db,notifications,comment.authorId,user,'commentLike',post,String(comment._id));json(res,201,{liked:true,likesCount:updated?.likesCount??await commentLikesCount(db,comment._id)})}catch(e){if(e.code===11000)json(res,200,{liked:true,likesCount:await commentLikesCount(db,comment._id)});else throw e}return true}if(req.method==='DELETE'){const deleted=await likes.deleteOne({commentId:comment._id,userId:user._id});let likesCount;if(deleted.deletedCount){const updated=await db.collection('art_comments').findOneAndUpdate({_id:comment._id},[{$set:{likesCount:{$max:[0,{$subtract:[{$ifNull:['$likesCount',0]},1]}]}}}],{returnDocument:'after',projection:{likesCount:1}});likesCount=updated?.likesCount??await commentLikesCount(db,comment._id)}else likesCount=await commentLikesCount(db,comment._id);json(res,200,{liked:false,likesCount});return true}json(res,405,{error:'Método não permitido'});return true;
  }
  if(req.method==='DELETE'){
   if(!requireUser())return true;if(comment.authorId!==user.artId&&post.authorId!==user.artId){json(res,403,{error:'Você não pode excluir este comentário'});return true}
   const query=comment.parentId?{_id:comment._id}:{postId:post._id,$or:[{_id:comment._id},{parentId:comment._id}]};const removed=await db.collection('art_comments').find(query,{projection:{_id:1}}).toArray(),ids=removed.map(row=>row._id);await db.collection('art_comments').deleteMany({_id:{$in:ids}});if(ids.length)await db.collection('comment_likes').deleteMany({commentId:{$in:ids}});const updatedPost=await db.collection('art_posts').findOneAndUpdate({_id:post._id},[{$set:{commentCount:{$max:[0,{$subtract:[{$ifNull:['$commentCount',0]},ids.length]}]}}}],{returnDocument:'after',projection:{commentCount:1}});let remainingReplies=null;if(comment.parentId){const parent=await db.collection('art_comments').findOneAndUpdate({_id:comment.parentId},[{$set:{repliesCount:{$max:[0,{$subtract:[{$ifNull:['$repliesCount',0]},1]}]}}}],{returnDocument:'after',projection:{repliesCount:1}});remainingReplies=parent?.repliesCount??0}json(res,200,{ok:true,deletedCount:ids.length,commentCount:updatedPost?.commentCount??await commentsCount(db,post._id),repliesCount:remainingReplies});return true;
  }
  json(res,405,{error:'Método não permitido'});return true;
 }catch(e){const message=e.message||'Não foi possível processar a interação';const status=/comentário|resposta|mensagem|Requisição/i.test(message)?400:503;json(res,status,{error:message});return true}
}
module.exports={route,cleanupPost};
