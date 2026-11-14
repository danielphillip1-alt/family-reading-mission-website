import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBarber} from './barber-gifts.mjs';
process.env.AOM_BARBER_GIFT_SECRET='test-only-secret';
process.env.APP_URL='https://example.test';
const sid='cs_live_'+('B'.repeat(40));
const session={id:sid,livemode:true,mode:'payment',status:'complete',payment_status:'paid',
 payment_link:'plink_1UboGGRuZKBP2B3nzmcAPiQL',currency:'eur',amount_total:2499,
 created:Math.floor(Date.now()/1000),customer_details:{email:'supporter@example.test'},
 custom_fields:[{key:'booklanguage',dropdown:{value:'de'}}]};
function fixture(){
 let row=null;
 const pool={query:async(sql,p)=>{
  if(sql.includes('INSERT INTO aom_barber_gifts')){row={session_id:p[0],purchased_at:p[1],gift_hash:p[4],gift2_hash:p[5],claimed_at:null,claimed2_at:null};return {rowCount:1,rows:[]};}
  if(sql.startsWith('SELECT r.slug'))return {rowCount:1,rows:[{slug:'zachary-my-unique-hat-2026-11'}]};
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
 const tokens=[...x.res.body.matchAll(/gift=([a-f0-9]{64})/g)].map(a=>a[1]);
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
