'use strict';

const {ObjectId}=require('mongodb');

const AMOUNTS=Object.freeze([500,1000,2000,3000,5000,10000,20000,30000,50000,100000,200000,300000,500000]);
const CURRENCY='brl',POINTS_PER_REAL=10;

function amount(value){
 const cents=Number(value);
 if(!Number.isSafeInteger(cents)||!AMOUNTS.includes(cents))throw Error('Escolha um valor de doação disponível');
 return cents;
}
function points(cents){return Math.floor(cents*POINTS_PER_REAL/100)}
function publicPayment(row){return {id:String(row._id),amountCents:row.amountCents,currency:CURRENCY,status:row.status,createdAt:row.createdAt,confirmedAt:row.confirmedAt||null,netAmountCents:row.netAmountCents||0,points:points(row.netAmountCents||0)}}

let indexes;
async function ensureIndexes(db){
 if(!indexes)indexes=Promise.all([
  db.collection('donation_payments').createIndex({stripeSessionId:1},{unique:true,sparse:true}),
  db.collection('donation_payments').createIndex({stripePaymentIntentId:1},{unique:true,sparse:true}),
  db.collection('donation_payments').createIndex({userId:1,createdAt:-1}),
  db.collection('donation_confirmations').createIndex({stripePaymentIntentId:1},{unique:true}),
  db.collection('donation_confirmations').createIndex({userId:1,confirmedAt:-1}),
  db.collection('stripe_events').createIndex({stripeEventId:1},{unique:true}),
  db.collection('stripe_events').createIndex({receivedAt:1}),
  db.collection('donation_checkout_limits').createIndex({expiresAt:1},{expireAfterSeconds:0})
 ]).catch(error=>{indexes=null;throw error});
 return indexes;
}

async function createOperation(db,user,amountCents){
 await ensureIndexes(db);amountCents=amount(amountCents);
 const now=new Date(),windowStart=new Date(now.getTime()-10*60*1000),limits=db.collection('donation_checkout_limits'),stale={$or:[{$eq:[{$type:'$windowStartedAt'},'missing']},{$lte:['$windowStartedAt',windowStart]}]};
 const key=String(user._id),current=await limits.findOneAndUpdate({_id:key,$or:[{count:{$lt:5}},{windowStartedAt:{$lte:windowStart}},{windowStartedAt:{$exists:false}}]},[{$set:{windowStartedAt:{$cond:[stale,now,'$windowStartedAt']},count:{$cond:[stale,1,{$add:[{$ifNull:['$count',0]},1]}]},expiresAt:new Date(now.getTime()+20*60*1000)}}],{upsert:true,returnDocument:'after'});
 if(!current)throw Object.assign(Error('Muitas tentativas de pagamento. Aguarde alguns minutos.'),{status:429});
 const operation={userId:user._id,artistId:user.artId,amountCents,currency:CURRENCY,status:'creating',netAmountCents:0,createdAt:now,updatedAt:now};
 const result=await db.collection('donation_payments').insertOne(operation);
 return {...operation,_id:result.insertedId};
}

async function attachCheckout(db,id,session){
 await db.collection('donation_payments').updateOne({_id:id,status:'creating'},{$set:{status:'pending',stripeSessionId:session.id,updatedAt:new Date()}});
}
async function failOperation(db,id){await db.collection('donation_payments').updateOne({_id:id,status:{$in:['creating','pending']}},{$set:{status:'failed',updatedAt:new Date()}})}

async function paymentForStripeObject(db,obj){
 const sessionId=obj.object==='checkout.session'&&typeof obj.id==='string'?obj.id:null;
 const paymentIntent=typeof obj.payment_intent==='string'?obj.payment_intent:(typeof obj.payment_intent?.id==='string'?obj.payment_intent.id:(obj.object==='payment_intent'&&typeof obj.id==='string'?obj.id:null));
 const operationId=obj.metadata?.donationOperationId;
 const filters=[];
 if(sessionId)filters.push({stripeSessionId:sessionId});
 if(paymentIntent)filters.push({stripePaymentIntentId:paymentIntent});
 if(operationId&&ObjectId.isValid(operationId))filters.push({_id:new ObjectId(operationId)});
 return filters.length?db.collection('donation_payments').findOne({$or:filters}):null;
}
async function markPaid(db,row,details={}){
 if(!row)return false;
 const paymentIntent=details.paymentIntent||row.stripePaymentIntentId;
 const now=new Date(),set={status:'paid',confirmedAt:row.confirmedAt||now,updatedAt:now,netAmountCents:row.amountCents};
 if(paymentIntent)set.stripePaymentIntentId=paymentIntent;
 if(details.sessionId)set.stripeSessionId=details.sessionId;
 const updated=await db.collection('donation_payments').updateOne({_id:row._id,status:{$nin:['refunded','partially_refunded','disputed']}},{$set:set});
 // Events can arrive out of order. Never recreate a confirmation after a
 // refund or dispute merely because Checkout delivers a late success event.
 if(!updated.modifiedCount||!paymentIntent)return false;
 await db.collection('donation_confirmations').updateOne({stripePaymentIntentId:paymentIntent},{$setOnInsert:{userId:row.userId,artistId:row.artistId,amountCents:row.amountCents,currency:CURRENCY,confirmedAt:now,createdAt:now},$set:{status:'paid',netAmountCents:row.amountCents,updatedAt:now}},{upsert:true});
 return true;
}
async function adjustPayment(db,row,{status,netAmountCents,paymentIntent,from}){
 if(!row)return false;const net=Math.max(0,Math.min(row.amountCents,Number(netAmountCents)||0)),intent=paymentIntent||row.stripePaymentIntentId;
 const query={_id:row._id,...(from?{status:{$in:from}}:{})},updated=await db.collection('donation_payments').updateOne(query,{$set:{status,netAmountCents:net,updatedAt:new Date(),...(intent?{stripePaymentIntentId:intent}:{})}});
 if(!updated.modifiedCount)return false;
 if(intent)await db.collection('donation_confirmations').updateOne({stripePaymentIntentId:intent},{$set:{status,netAmountCents:net,updatedAt:new Date()}},{upsert:false});
 return true;
}
async function history(db,user){
 await ensureIndexes(db);const rows=await db.collection('donation_payments').find({userId:user._id},{projection:{amountCents:1,currency:1,status:1,createdAt:1,confirmedAt:1,netAmountCents:1}}).sort({createdAt:-1}).limit(50).toArray();
 const totals=await db.collection('donation_payments').aggregate([{$match:{userId:user._id}},{$group:{_id:null,total:{$sum:{$ifNull:['$netAmountCents',0]}}}}]).toArray(),confirmed=totals[0]?.total||0;
 return {payments:rows.map(publicPayment),totalConfirmedCents:confirmed,totalPoints:points(confirmed)};
}

module.exports={AMOUNTS,CURRENCY,POINTS_PER_REAL,amount,points,ensureIndexes,createOperation,attachCheckout,failOperation,paymentForStripeObject,markPaid,adjustPayment,history};
