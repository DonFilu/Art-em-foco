'use strict';
const {ObjectId}=require('mongodb');
const title='🎨 Bem-vindo ao Art em Foco!';
const body='Que bom ter você aqui!\n\nEste é um espaço para transformar suas ideias em arte. Crie seus desenhos e animações, desenvolva projetos e compartilhe suas criações com a comunidade.\n\nNosso propósito é valorizar a criatividade humana e o trabalho feito à mão por artistas. Queremos que cada publicação represente uma criação autêntica, sem aquela dúvida: “Será que isso foi feito por inteligência artificial?”\n\nObrigado por fazer parte da nossa comunidade. Estamos felizes em ter você conosco! 💜';
async function welcome(db,userId){
 await db.collection('notifications').updateOne({userId,type:'welcome'},{$setOnInsert:{userId,type:'welcome',title,body,createdAt:new Date(),readAt:null}},{upsert:true});
}
async function friendRequest(db,sender,recipient){
 const now=new Date();
 await db.collection('notifications').updateOne(
  {userId:recipient._id,type:'friend-request:'+sender.artId},
  {$set:{title:'👋 Novo pedido de amizade',body:'O artista '+(sender.displayName||sender.username||sender.artId)+' está pedindo sua amizade!',artistId:sender.artId,artistName:sender.displayName||sender.username||sender.artId,createdAt:now,readAt:null,status:'pending'},
   $setOnInsert:{userId:recipient._id,type:'friend-request:'+sender.artId}},
  {upsert:true}
 );
}
async function friendResponse(db,recipientId,senderArtId,action){
 await db.collection('notifications').updateOne({userId:recipientId,type:'friend-request:'+senderArtId},{$set:{status:action==='accept'?'accepted':'declined',readAt:new Date()}});
}
async function friendAccepted(db,requester,acceptingArtist){
 const name=acceptingArtist.displayName||acceptingArtist.username||acceptingArtist.artId;
 await db.collection('notifications').updateOne(
  {userId:requester._id,type:'friend-accepted:'+acceptingArtist.artId},
  {$set:{title:'💜 Pedido de amizade aceito!',body:'Seu pedido de amizade com '+name+' foi aceito!',createdAt:new Date(),readAt:null},
   $setOnInsert:{userId:requester._id,type:'friend-accepted:'+acceptingArtist.artId}},
  {upsert:true}
 );
}
async function route(req,res,pathname,{sessionUser,getDatabase,json}){
 if(pathname!=='/api/notifications'&&!/^\/api\/notifications\/[0-9a-f]{24}\/read$/.test(pathname))return false;
 try{
  const user=await sessionUser(req);
  if(!user){json(res,401,{error:'Entre com Google para ver notificações'});return true}
  const col=(await getDatabase()).collection('notifications');
  if(pathname==='/api/notifications'){
   if(req.method!=='GET'){json(res,405,{error:'Método não permitido'});return true}
   const rows=await col.find({userId:user._id}).sort({createdAt:-1}).limit(100).toArray();
   json(res,200,{viewerId:user.artId,soundEnabled:user.notificationSettings?.soundEnabled!==false,notifications:rows.map(n=>({id:String(n._id),title:n.title,body:n.body,artistId:n.artistId||null,artistName:n.artistName||null,status:n.status||null,createdAt:n.createdAt,readAt:n.readAt||null}))});return true;
  }
  if(req.method!=='PATCH'){json(res,405,{error:'Método não permitido'});return true}
  const id=new ObjectId(pathname.split('/')[3]);
  const result=await col.updateOne({_id:id,userId:user._id,readAt:null},{$set:{readAt:new Date()}});
  if(!result.matchedCount&&!(await col.findOne({_id:id,userId:user._id}))){json(res,404,{error:'Notificação não encontrada'});return true}
  json(res,200,{ok:true});return true;
 }catch(e){console.error('Erro em notificações:',e.message);json(res,503,{error:'Não foi possível carregar as notificações'});return true}
}
module.exports={welcome,friendRequest,friendResponse,friendAccepted,route};
