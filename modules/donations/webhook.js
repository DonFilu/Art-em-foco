'use strict';

const Stripe=require('stripe');
const repository=require('./repository');

function configured(){return !!(globalThis.process.env.STRIPE_SECRET_KEY&&globalThis.process.env.STRIPE_WEBHOOK_SECRET)}
function stripe(){return new Stripe(globalThis.process.env.STRIPE_SECRET_KEY,{apiVersion:'2025-09-30.clover'})}
async function apply(db,event){
 const object=event.data?.object||{},row=await repository.paymentForStripeObject(db,object);if(!row)return;
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  if(object.payment_status==='paid')await repository.markPaid(db,row,{sessionId:object.id,paymentIntent:typeof object.payment_intent==='string'?object.payment_intent:null});
 }else if(event.type==='checkout.session.expired')await repository.adjustPayment(db,row,{status:'expired',netAmountCents:0,from:['creating','pending']});
 else if(event.type==='payment_intent.payment_failed')await repository.adjustPayment(db,row,{status:'failed',netAmountCents:0,paymentIntent:object.id,from:['creating','pending']});
 else if(event.type==='charge.refunded')await repository.adjustPayment(db,row,{status:object.refunded?'refunded':'partially_refunded',netAmountCents:Math.max(0,row.amountCents-(object.amount_refunded||0)),paymentIntent:object.payment_intent,from:['paid','partially_refunded']});
 else if(event.type==='charge.dispute.created')await repository.adjustPayment(db,row,{status:'disputed',netAmountCents:0,paymentIntent:object.payment_intent,from:['paid','partially_refunded']});
 else if(event.type==='charge.dispute.closed'&&object.status==='won')await repository.adjustPayment(db,row,{status:'paid',netAmountCents:row.amountCents,paymentIntent:object.payment_intent,from:['disputed']});
}
async function process(db,raw,signature){
 if(!configured())throw Object.assign(Error('Webhook de pagamentos não configurado'),{status:503});
 let event;try{event=stripe().webhooks.constructEvent(raw,signature,globalThis.process.env.STRIPE_WEBHOOK_SECRET)}catch{throw Object.assign(Error('Assinatura do webhook inválida'),{status:400})}
 await repository.ensureIndexes(db);const events=db.collection('stripe_events'),now=new Date(),leaseId=require('crypto').randomUUID(),leaseExpiresAt=new Date(now.getTime()+5*60*1000);
 try{await events.insertOne({stripeEventId:event.id,type:event.type,receivedAt:now,status:'processing',leaseId,leaseExpiresAt})}catch(error){
  if(error.code!==11000)throw error;
  const previous=await events.findOne({stripeEventId:event.id});
  if(previous?.status==='processed'||!previous?.leaseExpiresAt||previous.leaseExpiresAt>now)return {duplicate:true};
  const claimed=await events.updateOne({stripeEventId:event.id,status:'processing',leaseExpiresAt:{$lte:now}},{$set:{leaseId,leaseExpiresAt,receivedAt:now}});
  if(!claimed.modifiedCount)return {duplicate:true};
 }
 try{await apply(db,event);await events.updateOne({stripeEventId:event.id,status:'processing',leaseId},{$set:{status:'processed',processedAt:new Date()},$unset:{leaseId:'',leaseExpiresAt:''}});return {ok:true}}
 catch(error){await events.updateOne({stripeEventId:event.id,status:'processing',leaseId},{$set:{leaseExpiresAt:new Date(0),lastError:'processing_failed'}}).catch(()=>{});throw error}
}
module.exports={configured,process,apply};
