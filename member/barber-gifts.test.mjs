import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBarber} from './barber-gifts.mjs';

process.env.AOM_BARBER_GIFT_SECRET='test-secret-not-for-production';
const sid='cs_live_'+('B'.repeat(40));
const session={id:sid,livemode:true,mode:'payment',status:'complete',
 payment_status:'paid',payment_link:'plink_1UboGGRuZKBP2B3nzmcAPiQL',
 currency:'eur',amount_total:2499,created:Math.floor(Date.now()/1000),
 customer_details:{email:'supporter@example.test'},
 custom_fields:[{key:'booklanguage',dropdown:{value:'de'}}]};
function fixture(){
 let saved=null;
 const pool={query:async(sql,params)=>{
   if(sql.includes('INSERT INTO aom_barber_gifts')){saved={session_id:params[0],purchased_at:params[1],
     buyer_language:params[3],gift_hash:params[4],claimed_at:null,access_hash:null,recipient_language:null};return {rowCount:1,rows:[]};}
   if(sql.startsWith('SELECT r.slug'))return {rowCount:1,rows:[{slug:'zachary-my-unique-hat-2026-11'}]};
   if(sql.includes('SELECT claimed_at FROM aom_barber_gifts'))return saved&&saved.gift_hash===params[0]
      ?{rowCount:1,rows:[{claimed_at:saved.claimed_at}]}:{rowCount:0,rows:[]};
   if(sql.includes('UPDATE aom_barber_gifts SET claimed_at')){if(!saved||saved.claimed_at||saved.gift_hash!==params[0])return {rowCount:0,rows:[]};
     saved.claimed_at=new Date();saved.recipient_language=params[2];saved.access_hash=params[3];
     return {rowCount:1,rows:[{session_id:saved.session_id}]};}
   if(sql.includes('SELECT purchased_at,recipient_language FROM aom_barber_gifts'))
     return saved&&saved.access_hash===params[0]?{rowCount:1,rows:[{purchased_at:saved.purchased_at,recipient_language:saved.recipient_language}]}:{rowCount:0,rows:[]};
   if(sql.includes('SELECT f.pdf_content'))return {rowCount:1,rows:[{pdf_content:Buffer.from('%PDF-1.7 demo')}]};
   throw Error('Unexpected database query: '+sql.slice(0,100));
 }};
 const stripe={checkout:{sessions:{retrieve:async(id)=>id===sid?session:null}}};
 return {stripe,pool};
}
async function request(f,pathname,method='GET',body=''){
 const res={status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers||{}},end(value){this.body=value}};
 const req={method,async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body)}};
 const url=new URL('https://example.test'+pathname);
 const handled=await handleBarber({req,res,url,stripe:f.stripe,pool:f.pool});
 return {handled,res};
}
test('Unpaid or unknown barber checkouts cannot access personal download links',async()=>{
 const f=fixture(),r=await request(f,'/barber/thanks?session_id=cs_live_INVALID');
 assert.equal(r.handled,true);assert.equal(r.res.status,403);
});
test('Barber receives one personal collection and only one redeemable gift',async()=>{
 const f=fixture();
 const buyer=await request(f,'/barber/thanks?session_id='+sid);
 assert.equal(buyer.res.status,200);
 assert.match(buyer.res.body,/Your personal downloads/);
 const match=buyer.res.body.match(/gift=([a-f0-9]{64})/);
 assert.ok(match,'Private gift token is generated');
 const token=match[1];
 const view=await request(f,'/barber/redeem?gift='+token);
 assert.equal(view.res.status,200);
 assert.match(view.res.body,/No payment required/);
 const form='gift='+token+'&email=reader%40example.test&language=pt-PT';
 const first=await request(f,'/barber/redeem','POST',form);
 assert.equal(first.res.status,200);
 assert.match(first.res.body,/Your gift is ready/);
 const second=await request(f,'/barber/redeem','POST',form);
 assert.equal(second.res.status,409);
 const after=await request(f,'/barber/redeem?gift='+token);
 assert.equal(after.res.status,409);
});
