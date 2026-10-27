'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const Stripe=require('stripe');
const repository=require('../modules/donations/repository');
const {sameOrigin}=require('../modules/donations');
const checkout=require('../modules/donations/checkout');

test('donation amounts are fixed server-side and points use confirmed BRL whole reais',()=>{
 assert.equal(repository.amount(500),500);
 assert.throws(()=>repository.amount(501));
 assert.throws(()=>repository.amount(999));
 assert.throws(()=>repository.amount(5000000));
 assert.equal(repository.points(500),50);
 assert.equal(repository.points(199),19);
});

test('checkout CSRF origin check accepts only the exact HTTPS application origin',()=>{
 assert.equal(sameOrigin({headers:{origin:'https://art.cidio.com.br',host:'art.cidio.com.br'}}),true);
 assert.equal(sameOrigin({headers:{origin:'https://attacker.example',host:'art.cidio.com.br'}}),false);
 assert.equal(sameOrigin({headers:{origin:'http://art.cidio.com.br',host:'art.cidio.com.br'}}),false);
 assert.equal(sameOrigin({headers:{host:'art.cidio.com.br'}}),false);
});

test('donation interface uses the authenticated APIs and never treats the success page as payment proof',()=>{
 const page=fs.readFileSync('doacoes.html','utf8'),client=fs.readFileSync('js/donations.js','utf8'),server=fs.readFileSync('server.js','utf8'),routes=fs.readFileSync('modules/donations/index.js','utf8');
 assert.match(page,/Minhas Doações/);
 assert.match(client,/api\/auth\/me/);
 assert.match(client,/api\/donations\/checkout/);
 assert.match(client,/confirmação será atualizada/);
 assert.match(routes,/readRaw\(req,1024\*1024\)/);
 assert.match(server,/modules\/donations/);
});

test('webhook processor records Stripe event IDs before applying and protects duplicate events',()=>{
 const source=fs.readFileSync('modules/donations/webhook.js','utf8');
 assert.match(source,/stripeEventId:event\.id/);
 assert.match(source,/error\.code!==11000/);
 assert.match(source,/status:'processed'/);
 assert.match(source,/leaseExpiresAt/);
});

test('a signed paid Checkout webhook is confirmed once and repeated delivery is idempotent',async()=>{
 const webhook=require('../modules/donations/webhook'),old={key:process.env.STRIPE_SECRET_KEY,secret:process.env.STRIPE_WEBHOOK_SECRET};
 process.env.STRIPE_SECRET_KEY='sk_test_123';process.env.STRIPE_WEBHOOK_SECRET='whsec_test_secret';
 const payment={_id:'payment-1',userId:'user-1',artistId:'AEF-00000001',amountCents:500,status:'pending',netAmountCents:0},events=new Map(),updates=[];
 const db={collection(name){return {
  createIndex:async()=>{},
  findOne:async query=>name==='donation_payments'?payment:events.get(query.stripeEventId)||null,
  insertOne:async row=>{if(events.has(row.stripeEventId)){const error=Error('duplicate');error.code=11000;throw error}events.set(row.stripeEventId,row)},
  updateOne:async(query,update)=>{updates.push([name,query,update]);if(name==='stripe_events'){const row=events.get(query.stripeEventId);if(row)Object.assign(row,update.$set||{})}return {modifiedCount:1}}
 }}};
 try{
  const event={id:'evt_donation_paid',type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_donation_paid',payment_status:'paid',payment_intent:'pi_donation_paid',metadata:{donationOperationId:'507f1f77bcf86cd799439011'}}}};
  const raw=Buffer.from(JSON.stringify(event)),signature=Stripe.webhooks.generateTestHeaderString({payload:raw,secret:process.env.STRIPE_WEBHOOK_SECRET});
  assert.deepEqual(await webhook.process(db,raw,signature),{ok:true});
  assert.equal(events.get(event.id).status,'processed');
  assert.equal(await webhook.process(db,raw,signature).then(value=>value.duplicate),true);
  assert.ok(updates.some(([name])=>name==='donation_payments'));
 }finally{if(old.key===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=old.key;if(old.secret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=old.secret}
});

test('a late paid event cannot restore a refunded or disputed donation confirmation',async()=>{
 const calls=[];const db={collection:name=>({updateOne:async(query)=>{calls.push([name,query]);return {modifiedCount:0}}})},row={_id:'payment-1',amountCents:500,status:'refunded',netAmountCents:0,stripePaymentIntentId:'pi_refunded'};
 assert.equal(await repository.markPaid(db,row,{paymentIntent:'pi_refunded'}),false);
 assert.equal(calls.filter(([name])=>name==='donation_confirmations').length,0);
});

test('charge identifiers participate in payment lookup and partial refunds retain only the net cents',async()=>{
 let lookup;const updates=[];const db={collection:name=>({findOne:async query=>{lookup=query;return null},updateOne:async(query,change)=>{updates.push({name,query,change});return {modifiedCount:1}}})};
 await repository.paymentForStripeObject(db,{object:'charge',id:'ch_test',payment_intent:'pi_test'});
 assert.deepEqual(lookup.$or,[{stripePaymentIntentId:'pi_test'},{stripeChargeId:'ch_test'}]);
 const row={_id:'p',amountCents:1000,stripePaymentIntentId:'pi_test'};
 assert.equal(await repository.adjustPayment(db,row,{status:'partially_refunded',netAmountCents:700,chargeId:'ch_test',from:['paid','partially_refunded']}),true);
 const update=updates.find(item=>item.name==='donation_payments');assert.deepEqual(update.query.status.$in,['paid','partially_refunded']);
 assert.equal(update.change.$set.netAmountCents,700);
});

test('the donation panel queries availability and keeps checkout disabled when Stripe is unavailable',()=>{
 const client=fs.readFileSync('js/donations.js','utf8'),routes=fs.readFileSync('modules/donations/index.js','utf8');
 assert.match(client,/api\/donations\/config/);assert.match(client,/Doações em breve/);
 assert.match(routes,/checkoutAvailable:checkout\.configured\(\)/);
});

test('Checkout defaults to card and only enables Pix through an explicit valid configuration',()=>{
 const old=process.env.STRIPE_CHECKOUT_PAYMENT_METHODS;
 try{
  delete process.env.STRIPE_CHECKOUT_PAYMENT_METHODS;
  assert.deepEqual(checkout.paymentMethods(),['card']);
  process.env.STRIPE_CHECKOUT_PAYMENT_METHODS='card,pix';
  assert.deepEqual(checkout.paymentMethods(),['card','pix']);
  process.env.STRIPE_CHECKOUT_PAYMENT_METHODS='pix';
  assert.equal(checkout.paymentMethods(),null);
  process.env.STRIPE_CHECKOUT_PAYMENT_METHODS='card,unknown';
  assert.equal(checkout.paymentMethods(),null);
 }finally{if(old===undefined)delete process.env.STRIPE_CHECKOUT_PAYMENT_METHODS;else process.env.STRIPE_CHECKOUT_PAYMENT_METHODS=old}
});

test('Checkout records a failed operation and returns only safe Stripe diagnostics',async()=>{
 const old={key:process.env.STRIPE_SECRET_KEY,base:process.env.CIDIO_ART_BASE_URL,methods:process.env.STRIPE_CHECKOUT_PAYMENT_METHODS};
 const calls=[];
 const db={collection(name){return {
  createIndex:async()=>{},
  findOneAndUpdate:async()=>({_id:'limit'}),
  insertOne:async()=>({insertedId:'operation'}),
  updateOne:async(query,change)=>{calls.push({name,query,change});return {modifiedCount:1}}
 }}};
 try{
  process.env.STRIPE_SECRET_KEY='rk_live_test_value';process.env.CIDIO_ART_BASE_URL='https://art.cidio.com.br';delete process.env.STRIPE_CHECKOUT_PAYMENT_METHODS;
  const requests=[];
  const client={checkout:{sessions:{create:async request=>{requests.push(request);const error=Error('key must never reach a log');error.code='permission_denied';error.type='StripePermissionError';error.statusCode=403;error.requestId='req_safe';throw error}}}};
  await assert.rejects(checkout.create(db,{_id:'user',artId:'AEF-00000001'},500,{client}),error=>{
   assert.equal(error.status,503);assert.equal(error.donationError.stage,'create_checkout_session');assert.equal(error.donationError.code,'permission_denied');assert.equal(error.donationError.requestId,'req_safe');assert.doesNotMatch(error.message,/key/);return true;
  });
  assert.deepEqual(requests[0].payment_method_types,['card']);
  assert.ok(calls.some(call=>call.name==='donation_payments'&&call.change.$set?.status==='failed'));
 }finally{for(const [key,value] of Object.entries(old)){const env=key==='base'?'CIDIO_ART_BASE_URL':key==='methods'?'STRIPE_CHECKOUT_PAYMENT_METHODS':'STRIPE_SECRET_KEY';if(value===undefined)delete process.env[env];else process.env[env]=value}}
});
