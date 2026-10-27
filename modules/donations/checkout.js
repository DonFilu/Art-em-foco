'use strict';

const Stripe=require('stripe');
const repository=require('./repository');

function baseUrl(){
 const value=process.env.CIDIO_ART_BASE_URL;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();return url.origin}catch{return null}
}
function secretKey(){
 const key=String(process.env.STRIPE_SECRET_KEY||'').trim();
 return /^(?:sk|rk)_(?:test|live)_/.test(key)?key:null;
}
function paymentMethods(value=process.env.STRIPE_CHECKOUT_PAYMENT_METHODS){
 // Pix must be explicitly enabled because availability depends on the Stripe
 // account. Card remains a safe, supported fallback for BRL Checkout.
 const methods=(value===undefined||value===null||String(value).trim()===''
  ?['card']:String(value).split(',').map(item=>item.trim().toLowerCase()).filter(Boolean));
 if(!methods.length||methods.length!==new Set(methods).size||!methods.includes('card')||methods.some(method=>!['card','pix'].includes(method)))return null;
 return methods;
}
function configured(){return !!(secretKey()&&baseUrl()&&paymentMethods())}
function stripe(){return new Stripe(secretKey(),{apiVersion:'2025-09-30.clover'})}
function checkoutError(error,stage){
 const code=typeof error?.code==='string'?error.code:null;
 const type=typeof error?.type==='string'?error.type:null;
 const status=Number.isInteger(error?.statusCode)?error.statusCode:null;
 const requestId=typeof error?.requestId==='string'?error.requestId:null;
 const paymentMethodUnavailable=code==='payment_method_unavailable'||code==='parameter_invalid_empty'&&/payment_method_types/.test(String(error?.param||''));
 return {stage,code,type,status,requestId,paymentMethodUnavailable};
}
async function create(db,user,value,options={}){
 if(!configured())throw Object.assign(Error('As doações estão temporariamente indisponíveis.'),{status:503,donationStage:'configuration'});
 const operation=await repository.createOperation(db,user,value),origin=baseUrl();
 try{
  const metadata={donationOperationId:String(operation._id),artistId:user.artId};
  const session=await (options.client||stripe()).checkout.sessions.create({mode:'payment',currency:'brl',payment_method_types:paymentMethods(),client_reference_id:user.artId,metadata,payment_intent_data:{metadata},line_items:[{price_data:{currency:'brl',unit_amount:operation.amountCents,product_data:{name:'Doação ao Cidio Art'}},quantity:1}],success_url:origin+'/doacoes.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/doacoes.html?checkout=cancel'});
  await repository.attachCheckout(db,operation._id,session);
  return {checkoutUrl:session.url};
 }catch(error){
  await repository.failOperation(db,operation._id).catch(()=>{});
  const details=checkoutError(error,'create_checkout_session');
  throw Object.assign(Error('Não foi possível iniciar o pagamento.'),{status:503,donationStage:details.stage,donationError:details});
 }
}
module.exports={baseUrl,secretKey,paymentMethods,configured,checkoutError,create};
