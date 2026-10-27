'use strict';

const crypto=require('crypto');
const repository=require('./repository');
const checkout=require('./checkout');
const webhook=require('./webhook');

function logDonationFailure(error,stage){
 const details=error?.donationError||{};
 // Keep production diagnostics actionable without recording payment details,
 // credentials, session tokens, or user information.
 console.error(JSON.stringify({event:'donation_checkout_failed',stage:details.stage||error?.donationStage||stage,code:details.code||null,type:details.type||null,stripeStatus:details.status||null,stripeRequestId:details.requestId||null,paymentMethodUnavailable:details.paymentMethodUnavailable===true}));
}

function sameOrigin(req){
 const origin=req.headers.origin;if(!origin)return false;
 try{return new URL(origin).host===String(req.headers.host||'').toLowerCase()&&new URL(origin).protocol==='https:'}catch{return false}
}
async function csrf(db,session){
 if(session.donationCsrfToken)return session.donationCsrfToken;
 const token=crypto.randomBytes(32).toString('base64url');const updated=await db.collection('sessions').findOneAndUpdate({_id:session._id,donationCsrfToken:{$exists:false}},{$set:{donationCsrfToken:token}},{returnDocument:'after'});return updated?.donationCsrfToken||token;
}
async function route(req,res,pathname,{sessionInfo,getDatabase,json,readJSON,readRaw}){
 if(pathname==='/api/donations/webhook'){
  if(req.method!=='POST')return json(res,405,{error:'Método não permitido'}),true;
  try{const raw=await readRaw(req,1024*1024);await webhook.process(await getDatabase(),raw,req.headers['stripe-signature']);return json(res,200,{received:true}),true}catch(error){return json(res,error.status||503,{error:error.status===400?'Assinatura inválida':'Não foi possível processar a confirmação'}),true}
 }
 if(!pathname.startsWith('/api/donations'))return false;
 try{
  const info=await sessionInfo(req);if(!info?.user)return json(res,401,{error:'Entre com Google para acessar doações'}),true;
  const db=await getDatabase();await repository.ensureIndexes(db);
  if(pathname==='/api/donations/config'&&req.method==='GET')return json(res,200,{checkoutAvailable:checkout.configured()}),true;
  if(pathname==='/api/donations/history'&&req.method==='GET')return json(res,200,await repository.history(db,info.user)),true;
  if(pathname==='/api/donations/csrf'&&req.method==='GET')return json(res,200,{csrfToken:await csrf(db,info.session)}),true;
  if(pathname==='/api/donations/checkout'&&req.method==='POST'){
   if(!sameOrigin(req)||req.headers['x-donation-csrf']!==await csrf(db,info.session))return json(res,403,{error:'Requisição inválida'}),true;
   const body=await readJSON(req);if(!body||Array.isArray(body)||Object.keys(body).length!==1)return json(res,400,{error:'Pedido inválido'}),true;
   return json(res,201,await checkout.create(db,info.user,body.amountCents)),true;
  }
  return json(res,405,{error:'Método não permitido'}),true;
 }catch(error){
  const status=error.status||(/valor|Pedido/.test(error.message)?400:503);
  if(pathname==='/api/donations/checkout'&&status>=500)logDonationFailure(error,'checkout_route');
  const unavailable=error?.donationError?.paymentMethodUnavailable===true;
  return json(res,status,{error:error.status===429?error.message:unavailable?'O método de pagamento não está disponível no momento. Tente novamente mais tarde.':'Não foi possível processar a doação'}),true
 }
}
module.exports={route,sameOrigin,csrf,logDonationFailure};
