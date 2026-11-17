import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
process.env.AOM_BARBER_GIFT_SECRET='test-only-secret';
process.env.APP_URL='https://example.test';
const {handleStorybook}=await import('./storybook-gifts.mjs');
const sha=v=>createHash('sha256').update(v).digest('hex');
const pdf=n=>Buffer.from('%PDF-1.7 book '+n+' %%EOF');
// German: Zachary 1-3, Emir 1-2 approved; Emir Book Three stored but editorially locked.
const books={
 'zachary-my-unique-hat-2026-11':pdf(1),'zachary-school-that-believed-in-him':pdf(2),'zachary-school-that-made-room':pdf(3),
 'emir-boy-who-never-smiles':pdf(4),'emir-barbershop-boys-and-salon-girls':pdf(5),'emir-meets-zachary':pdf(6)
};
function fixture(kind,expires=null){
 const token=randomBytes(32).toString('hex');
 const claim={token_hash:sha(token),source_hash:'s',slot:1,sender:'Grandma',recipient:'Mia'};
 const pool={query:async(sql,p=[])=>{
  if(sql.includes('FROM aom_storybook_claims WHERE token_hash=$1'))return {rows:p[0]===claim.token_hash?[claim]:[]};
  if(sql.includes('SELECT kind,expires_at FROM aom_storybook_sources'))return {rows:[{kind,expires_at:expires}]};
  if(sql.trimStart().startsWith('SELECT slug FROM aom_storybook_files'))
   return {rows:p[0]==='de'?Object.keys(books).reverse().map(slug=>({slug})):p[0]==='en'?[{slug:'emir-boy-who-never-smiles'}]:[]};
  if(sql.includes('SELECT size,sha256 FROM aom_storybook_files'))
   return {rows:books[p[0]]?[{size:books[p[0]].length,sha256:sha(books[p[0]])}]:[]};
  if(sql.includes('FROM aom_storybook_pdf_parts'))return {rows:[{part:0,bytes:books[p[0]]}]};
  throw Error('Unexpected query '+sql.slice(0,80));
 }};
 return {pool,token};
}
async function call(f,path,headers={}){
 const res={status:0,headers:{},chunks:[],headersSent:false,destroyed:false,
  writeHead(s,h){this.status=s;this.headers=h;this.headersSent=true},
  write(v){this.chunks.push(Buffer.from(v));return true},
  end(v){if(v!==undefined)this.chunks.push(Buffer.from(v))},
  on(){},once(){},emit(){},removeListener(){}};
 const req={method:'GET',headers,async *[Symbol.asyncIterator](){}};
 await handleStorybook({req,res,url:new URL('https://example.test'+path),pool:f.pool,stripe:null});
 return {...res,body:Buffer.concat(res.chunks)};
}
for(const kind of ['free','paid']){
 test(kind+' gift: page offers exactly Language then Download, with no PIN, purchase or price',async()=>{
  const f=fixture(kind);
  const page=await call(f,'/storybook/gift?gift='+f.token,{'accept-language':'de-DE,de;q=0.9'});
  assert.equal(page.status,200);
  const html=page.body.toString('utf8');
  assert.match(html,/<select id="language" name="language" required>/);
  assert.match(html,/<option value="de" selected>Deutsch \(5\)<\/option>/,'German preselected for a German phone, five approved books');
  assert.match(html,/<option value="en">English \(1\)<\/option>/);
  assert.doesNotMatch(html,/value="fr"/,'languages without books are not offered');
  assert.match(html,/<button class="open" id="open" type="submit">Herunterladen<\/button>/);
  assert.doesNotMatch(html,/name="code"|Purchase|€|\$|buy\.stripe/i);
  assert.equal((html.match(/<form/g)||[]).length,1);
 });
}
test('gift ZIP contains only approved German books, numbered in series folders, at exact length',async()=>{
 const f=fixture('free');
 const zip=await call(f,'/storybook/download-all?gift='+f.token+'&language=de');
 assert.equal(zip.status,200);
 assert.equal(zip.headers['Content-Length'],zip.body.length);
 assert.equal(zip.headers['X-AOM-Book-Count'],'5');
 assert.match(zip.headers['Content-Disposition'],/Authors_On_A_Mission_de_5_Books\.zip/);
 const eocd=zip.body.length-22;
 assert.equal(zip.body.readUInt32LE(eocd),0x06054b50);
 let at=zip.body.readUInt32LE(eocd+16);const names=[];
 for(let i=0;i<zip.body.readUInt16LE(eocd+10);i++){
  const n=zip.body.readUInt16LE(at+28);names.push(zip.body.subarray(at+46,at+46+n).toString());at+=46+n;
 }
 assert.deepEqual(names,[
  '01_Zachary_Series/01_Zachary_Book_1_My_Unique_Hat_de.pdf',
  '01_Zachary_Series/02_Zachary_Book_2_The_School_That_Believed_de.pdf',
  '01_Zachary_Series/03_Zachary_Book_3_The_School_That_Made_Room_de.pdf',
  '02_Emir_Series/01_Emir_Book_1_The_Boy_Who_Never_Smiles_de.pdf',
  '02_Emir_Series/02_Emir_Book_2_Barbershop_And_Salon_de.pdf']);
});
test('expired QA gift no longer downloads; a random token never downloads',async()=>{
 const f=fixture('qa',new Date(Date.now()-1000));
 const expired=await call(f,'/storybook/download-all?gift='+f.token+'&language=de');
 assert.notEqual(expired.status,200);
 const stranger=await call(f,'/storybook/download-all?gift='+randomBytes(32).toString('hex')+'&language=de');
 assert.equal(stranger.status,404);
});
