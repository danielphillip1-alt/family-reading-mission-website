import {createHmac} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBarber,sendCheckoutGiftInvitations} from './barber-gifts.mjs';
process.env.AOM_BARBER_GIFT_SECRET='test-only-secret';
process.env.APP_URL='https://example.test';
const sid='cs_live_'+('B'.repeat(40));
const session={id:sid,livemode:true,mode:'payment',status:'complete',payment_status:'paid',
 payment_link:'plink_1UboGGRuZKBP2B3nzmcAPiQL',currency:'eur',amount_total:2499,
 created:Math.floor(Date.now()/1000),customer_details:{email:'supporter@example.test'},
 custom_fields:[{key:'booklanguage',dropdown:{value:'de'}}]};
function fixture(fullCatalog=false){
 let row=null;
 const pool={query:async(sql,p)=>{
  if(sql.includes('INSERT INTO aom_barber_gifts')){if(!row)row={session_id:p[0],purchased_at:p[1],gift_hash:p[4],gift2_hash:p[5],claimed_at:null,claimed2_at:null};return {rowCount:1,rows:[]};}
  if(sql.includes('SET gift1_invited_at=now()')||sql.includes('SET gift2_invited_at=now()')){
   const field=sql.includes('gift1_invited_at')?'invited1':'invited2';
   if(!row||row[field])return {rowCount:0,rows:[]};
   row[field]=true;return {rowCount:1,rows:[{session_id:row.session_id}]};
  }
  if(sql.includes('SET gift1_invited_at=NULL')||sql.includes('SET gift2_invited_at=NULL')){
   if(row)row[sql.includes('gift1_invited_at')?'invited1':'invited2']=false;
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT r.slug')){const rows=fullCatalog?[{slug:'zachary-my-unique-hat-2026-11'},{slug:'zachary-school-that-believed-in-him'},{slug:'emir-boy-who-never-smiles'},{slug:'emir-barbershop-boys-and-salon-girls'}]:[{slug:'zachary-my-unique-hat-2026-11'}];return {rowCount:rows.length,rows};}
  if(sql.includes('SELECT CASE WHEN gift_hash=$1 THEN claimed_at'))return row&&(row.gift_hash===p[0]||row.gift2_hash===p[0])?{rowCount:1,rows:[{claimed_at:row.gift_hash===p[0]?row.claimed_at:row.claimed2_at}]}:{rowCount:0,rows:[]};
  if(sql.includes('UPDATE aom_barber_gifts SET')&&sql.includes('claimed2_at')){
   const first=row?.gift_hash===p[0],second=row?.gift2_hash===p[0];
   if(!row||(!first&&!second)||(first&&row.claimed_at)||(second&&row.claimed2_at))return {rowCount:0,rows:[]};
   if(first){row.claimed_at=new Date();row.recipient_language=p[2];row.access_hash=p[3]}
   else{row.claimed2_at=new Date();row.recipient2_language=p[2];row.access2_hash=p[3]}
   return {rowCount:1,rows:[{session_id:row.session_id}]};
  }
  if(sql.includes('SELECT purchased_at,CASE WHEN access_hash=$1'))return row&&(row.access_hash===p[0]||row.access2_hash===p[0])?{rowCount:1,rows:[{purchased_at:row.purchased_at,recipient_language:row.access_hash===p[0]?row.recipient_language:row.recipient2_language}]}:{rowCount:0,rows:[]};
  if(sql.includes('SELECT f.pdf_content'))return {rowCount:1,rows:[{pdf_content:Buffer.from('%PDF-1.7 demo')}]};
  throw new Error('Unexpected database query: '+sql.slice(0,150));
 }};
 const stripe={checkout:{sessions:{retrieve:async(id)=>id===sid?session:null}}};
 return {stripe,pool};
}
async function request(f,path,method='GET',body=''){
 const res={status:0,body:null,headers:{},writeHead(status,h){this.status=status;this.headers=h||{}},end(v){this.body=v}};
 const req={method,async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body)}};
 const handled=await handleBarber({req,res,url:new URL('https://example.test'+path),stripe:f.stripe,pool:f.pool});
 return {handled,res};
}
test('Unpaid orders cannot access purchased digital books',async()=>{
 const f=fixture();const x=await request(f,'/barber/thanks?session_id=cs_live_INVALID');assert.equal(x.res.status,403);
});
test('Two distinct, single-use gift links redeem separately and in different languages',async()=>{
 const f=fixture();const x=await request(f,'/barber/thanks?session_id='+sid);
 assert.equal(x.res.status,200);
 assert.match(x.res.body,/Your personal downloads/);
 assert.match(x.res.body,/Personalize your two gifts/);
 const tokens=[1,2].map(slot=>createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET).update(slot===1?'gift:'+sid:'gift2:'+sid).digest('hex'));
 assert.equal(new Set(tokens).size,2);
 for(const [i,token] of [...new Set(tokens)].entries()){
  const view=await request(f,'/barber/redeem?gift='+token);assert.equal(view.res.status,200);
  const post=await request(f,'/barber/redeem','POST','gift='+token+'&email=reader'+i+'%40example.test&language='+(i?'pt-PT':'en'));
  assert.equal(post.res.status,200);
  const link=post.res.body.match(/\/barber\/books\?access=([a-f0-9]{64})/);assert.ok(link);
  const read=await request(f,'/barber/books?access='+link[1]);assert.equal(read.res.status,200);
  const twice=await request(f,'/barber/redeem','POST','gift='+token+'&email=x%40example.test&language=en');assert.equal(twice.res.status,409);
 }
});

test('Paid checkout emails exactly two invited recipients and never repeats on refresh',async()=>{
 const f=fixture();const prev={key:process.env.AOM_RESEND_API_KEY,from:process.env.AOM_FROM_EMAIL,fetch:globalThis.fetch};
 const sent=[];
 try{
  process.env.AOM_RESEND_API_KEY='test-key';
  process.env.AOM_FROM_EMAIL='book@example.test';
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);sent.push(body.to[0]);return {ok:true,json:async()=>({id:'test'})}};
  const paid={...session,custom_fields:[...session.custom_fields,
    {key:'giftoneemail',text:{value:'parent1@example.test'}},
    {key:'gifttwoemail',text:{value:'parent2@example.test'}}]};
  await sendCheckoutGiftInvitations({pool:f.pool,session:paid});
  await sendCheckoutGiftInvitations({pool:f.pool,session:paid});
  assert.deepEqual(sent,['parent1@example.test','parent2@example.test']);
  const unpaid={...paid,payment_status:'unpaid'};
  assert.deepEqual(await sendCheckoutGiftInvitations({pool:f.pool,session:unpaid}),[]);
  assert.equal(sent.length,2);
 }finally{
  if(prev.key===undefined)delete process.env.AOM_RESEND_API_KEY;else process.env.AOM_RESEND_API_KEY=prev.key;
  if(prev.from===undefined)delete process.env.AOM_FROM_EMAIL;else process.env.AOM_FROM_EMAIL=prev.from;
  globalThis.fetch=prev.fetch;
 }
});

test('Checkout is blocked while fewer than four approved books exist in each language',async()=>{
 const f=fixture(false);
 const r=await request(f,'/barber/checkout');
 assert.equal(r.res.status,503);
 assert.match(r.res.body,/No payment has been taken/);
});
test('Checkout redirects to existing one-time Stripe payment link only with four shared approved book slugs',async()=>{
 const f=fixture(true);
 const r=await request(f,'/barber/checkout');
 assert.equal(r.res.status,303);
 assert.equal(r.res.headers.Location,'https://buy.stripe.com/14AdRbcsQ96aeDKe89ffy03');
});
