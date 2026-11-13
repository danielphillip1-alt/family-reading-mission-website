import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePurchaseDelivery} from './instant-book.mjs';
const SESSION_ID='cs_live_'+('A'.repeat(40));
function fixture({paid=true,active=true,knownLink=true,pdfReady=true}={}){
 const session={id:SESSION_ID,livemode:true,mode:'subscription',
  payment_link:knownLink?'plink_1UbGQ6RuZKBP2B3nVEKI0Y7h':'plink_unknown',
  status:paid?'complete':'open',payment_status:paid?'paid':'unpaid',
  subscription:'sub_test',customer:'cus_test',
  custom_fields:[{key:'booklanguage',dropdown:{value:'de'}}]};
 const stripe={
  checkout:{sessions:{retrieve:async()=>session}},
  subscriptions:{retrieve:async()=>({status:active?'active':'canceled',
   items:{data:[{current_period_end:Math.floor(Date.now()/1000)+3600}]}})}
 };
 const queries=[];
 const pool={query:async(sql,params)=>{queries.push({sql,params});return pdfReady?{
  rowCount:1,rows:sql.includes('pdf_content')?[{pdf_content:Buffer.from('%PDF-1.7 test signed payload')}]:[{language:'de'}]
 }:{rowCount:0,rows:[]}}};
 const res={status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers||{}},
  end(value){this.body=value}};
 return {stripe,pool,res,queries};
}
async function call(path,fixtureOptions){
 const f=fixture(fixtureOptions);
 await handlePurchaseDelivery({req:{method:'GET'},res:f.res,
  url:new URL('https://aom.example'+path),stripe:f.stripe,pool:f.pool});
 return f;
}
test('Unpaid checkout cannot obtain even a landing page or book',async()=>{
 for(const path of ['/purchase-success','/purchase-book?lang=en']){
  const f=await call(path+(path.includes('?')?'&':'?')+'session_id='+SESSION_ID,{paid:false});
  assert.equal(f.res.status,403);
  assert.equal(f.queries.length,0);
 }
});
test('Unknown payment links and canceled subscriptions never authorize books',async()=>{
 for(const option of [{knownLink:false},{active:false}]){
  const f=await call('/purchase-book?session_id='+SESSION_ID+'&lang=de',option);
  assert.equal(f.res.status,403);
  assert.equal(f.queries.length,0);
 }
});
test('Paid live subscriber can open checkout success page and choose German',async()=>{
 const f=await call('/purchase-success?session_id='+SESSION_ID);
 assert.equal(f.res.status,200);
 assert.match(f.res.body,/Download full book — Deutsch/);
 assert.match(f.res.body,/Manage or cancel your membership/);
});
test('Book requires a verified payment and returns private PDF attachment',async()=>{
 const f=await call('/purchase-book?session_id='+SESSION_ID+'&lang=de');
 assert.equal(f.res.status,200);
 assert.equal(f.res.headers['Content-Type'],'application/pdf');
 assert.equal(f.res.headers['Cache-Control'],'no-store');
 assert.equal(f.res.headers['Content-Length'],f.res.body.length);
 assert.equal(f.queries[0].params[0],'de');
});
test('Do not silently substitute a missing language',async()=>{
 const f=await call('/purchase-book?session_id='+SESSION_ID+'&lang=pt-PT',{pdfReady:false});
 assert.equal(f.res.status,503);
});
