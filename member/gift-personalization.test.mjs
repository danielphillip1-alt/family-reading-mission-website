import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {handleGiftPersonalization} from './gift-personalization.mjs';
const previous={secret:process.env.AOM_BARBER_GIFT_SECRET,url:process.env.APP_URL};
process.env.AOM_BARBER_GIFT_SECRET='unit-test-only-secret';
process.env.APP_URL='https://books.example.test';
const sid='cs_live_'+('Z'.repeat(40));
const session={id:sid,livemode:true,mode:'payment',status:'complete',payment_status:'paid',payment_link:'plink_1UboGGRuZKBP2B3nzmcAPiQL',currency:'eur',amount_total:2499,created:1770000000,customer_details:{email:'buyer@example.test'}};
const token=slot=>createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET).update(slot===1?'gift:'+sid:'gift2:'+sid).digest('hex');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
let row={session_id:sid,purchased_at:new Date(session.created*1000),buyer_email:'buyer@example.test',gift_hash:hash(token(1)),gift2_hash:hash(token(2)),gift1_invited_at:null,gift2_invited_at:null,claimed_at:null,claimed2_at:null};
const pool={query:async(sql,p)=>{
 if(sql.startsWith('SELECT sender_name,barber_shop_name,recipient1_name,recipient2_name,claimed_at'))return (row.gift_hash===p[0]||row.gift2_hash===p[0])?{rowCount:1,rows:[row]}:{rowCount:0,rows:[]};
 if(sql.startsWith('SELECT sender_name,barber_shop_name,recipient1_name,recipient2_name,gift1_invited_at'))return {rowCount:1,rows:[row]};
 if(sql.startsWith('INSERT INTO aom_barber_gifts'))return {rowCount:0,rows:[]};
 if(sql.startsWith('UPDATE aom_barber_gifts SET sender_name=')){
  if(row.gift1_invited_at||row.gift2_invited_at)return {rowCount:0,rows:[]};
  Object.assign(row,{sender_name:p[1],barber_shop_name:p[2],recipient1_name:p[3],recipient2_name:p[4]});
  return {rowCount:1,rows:[{session_id:sid}]};
 }
 if(sql.trimStart().startsWith('SELECT slug FROM aom_storybook_files'))return {rows:p[0]==='pt-PT'?[]:[{slug:'zachary-my-unique-hat-2026-11'},{slug:'emir-boy-who-never-smiles'}]};
 if(sql.includes('SELECT size,sha256 FROM aom_storybook_files'))return {rows:[{size:20,sha256:'a'.repeat(64)}]};
 throw Error('Unexpected SQL '+sql.slice(0,100));
}};
const stripe={checkout:{sessions:{retrieve:async id=>id===sid?session:null}}};
return {pool,stripe,row};
}
async function call(f,path,method='GET',body=''){
 const req={method,headers:{'accept-language':'de-DE'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body)}};
 const res={status:null,headers:{},body:'',writeHead(s,h){this.status=s;this.headers=h||{}},end(b){this.body=b||''}};
 const handled=await handleGiftPersonalization({req,res,url:new URL('https://books.example.test'+path),...f});
 return {handled,res};
}
test('unpaid or fake checkout cannot personalize gifts',async()=>{
 const f=fixture(); const x=await call(f,'/barber/setup?session_id=cs_live_INVALID');
 assert.equal(x.res.status,403);
});
test('two personalized recipient links carry independent names with the same sender',async()=>{
 const f=fixture();
 const page=await call(f,'/barber/setup?session_id='+sid);
 assert.equal(page.res.status,200);
 assert.match(page.res.body,/Gift recipient 2 name/);
 const form=new URLSearchParams({session_id:sid,sender_name:'Daniel',barber_shop_name:'Rosewood Barbershop',recipient1_name:'Jamie',recipient2_name:'Casey'});
 const post=await call(f,'/barber/setup','POST',form.toString());
 assert.equal(post.res.status,200);
 assert.match(post.res.body,/Jamie/);assert.match(post.res.body,/Casey/);
 const a=await call(f,'/barber/open?gift='+token(1)),b=await call(f,'/barber/open?gift='+token(2));
 assert.equal(a.res.status,200);assert.equal(b.res.status,200);
 assert.match(a.res.body,/Jamie, <span class="sender">Daniel \(Rosewood Barbershop\)<\/span>/);
 assert.match(b.res.body,/Casey, <span class="sender">Daniel/);
 // Exactly Language -> Download: one form to /barber/redeem with download=1, no PIN or price.
 assert.match(a.res.body,/<form method="get" action="\/barber\/redeem"[^>]*><input type="hidden" name="gift" value="[a-f0-9]{64}"><input type="hidden" name="download" value="1">/);
 assert.match(a.res.body,/<option value="de" selected>Deutsch \(2\)<\/option>/);
 assert.doesNotMatch(a.res.body,/value="pt-PT"|name="code"|buy\.stripe/,'languages without books are hidden');
 assert.match(a.res.body,/<option value="fr">Français \(2\)<\/option>/);
 assert.match(a.res.body,/>Herunterladen<\/button>/);
 assert.ok(a.res.body.includes(token(1))&&b.res.body.includes(token(2)));
 f.row.claimed_at=new Date();
 const already=await call(f,'/barber/open?gift='+token(1));
 assert.equal(already.res.status,409);
 const second=await call(f,'/barber/open?gift='+token(2));
 assert.equal(second.res.status,200);
});
test('invalid tokens cannot load personalized landing page',async()=>{
 const f=fixture(), bad=await call(f,'/barber/open?gift='+'0'.repeat(64));
 assert.equal(bad.res.status,404);
});
test('buyer names are rendered as escaped text, not injected HTML',async()=>{
 const f=fixture();f.row.sender_name='<script>alert(1)</script>';
 f.row.recipient1_name='Jamie';f.row.barber_shop_name='Smith & Sons';
 const q=await call(f,'/barber/open?gift='+token(1));
 assert.equal(q.res.status,200);
 assert.doesNotMatch(q.res.body,/<script>alert/);
 assert.match(q.res.body,/Smith &amp; Sons/);
});
