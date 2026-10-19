'use strict';
const {ObjectId}=require('mongodb');
const title='🎨 Bem-vindo ao Art em Foco!';
const body='Que bom ter você aqui!\n\nEste é um espaço para transformar suas ideias em arte. Crie seus desenhos e animações, desenvolva projetos e compartilhe suas criações com a comunidade.\n\nNosso propósito é valorizar a criatividade humana e o trabalho feito à mão por artistas. Queremos que cada publicação represente uma criação autêntica, sem aquela dúvida: “Será que isso foi feito por inteligência artificial?”\n\nObrigado por fazer parte da nossa comunidade. Estamos felizes em ter você conosco! 💜';
async function welcome(db,userId){
 await db.collection('notifications').updateOne({userId,type:'welcome'},{$setOnInsert:{userId,type:'welcome',title,body,createdAt:new Date(),readAt:null}},{upsert:true});
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
   json(res,200,{notifications:rows.map(n=>({id:String(n._id),title:n.title,body:n.body,createdAt:n.createdAt,readAt:n.readAt||null}))});return true;
  }
  if(req.method!=='PATCH'){json(res,405,{error:'Método não permitido'});return true}
  const id=new ObjectId(pathname.split('/')[3]);
  const result=await col.updateOne({_id:id,userId:user._id,readAt:null},{$set:{readAt:new Date()}});
  if(!result.matchedCount&&!(await col.findOne({_id:id,userId:user._id}))){json(res,404,{error:'Notificação não encontrada'});return true}
  json(res,200,{ok:true});return true;
 }catch(e){console.error('Erro em notificações:',e.message);json(res,503,{error:'Não foi possível carregar as notificações'});return true}
}
module.exports={welcome,route};
