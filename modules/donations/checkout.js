'use strict';

const Stripe=require('stripe');
const repository=require('./repository');

function baseUrl(){
 const value=process.env.CIDIO_ART_BASE_URL;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();return url.origin}catch{return null}
}
function configured(){return !!(process.env.STRIPE_SECRET_KEY&&baseUrl())}
function stripe(){return new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2025-09-30.clover'})}
async function create(db,user,value){
 if(!configured())throw Object.assign(Error('As doações estão temporariamente indisponíveis.'),{status:503});
 const operation=await repository.createOperation(db,user,value),origin=baseUrl();
 try{
  const metadata={donationOperationId:String(operation._id),artistId:user.artId};
  const session=await stripe().checkout.sessions.create({mode:'payment',currency:'brl',payment_method_types:['card','pix'],client_reference_id:user.artId,metadata,payment_intent_data:{metadata},line_items:[{price_data:{currency:'brl',unit_amount:operation.amountCents,product_data:{name:'Doação ao Cidio Art'}},quantity:1}],success_url:origin+'/doacoes.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/doacoes.html?checkout=cancel'});
  await repository.attachCheckout(db,operation._id,session);
  return {checkoutUrl:session.url};
 }catch(error){await repository.failOperation(db,operation._id).catch(()=>{});throw error}
}
module.exports={baseUrl,configured,create};
