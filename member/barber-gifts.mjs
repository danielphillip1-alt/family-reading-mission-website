import {createHash,createHmac,randomBytes} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {sendTransactionalMail,mailConfigured} from './mail.mjs';
import {bundleTitle,isBundleBook,shelfPage} from './gift-shelf.mjs';

function crc32(buf){let crc=0xffffffff;for(const byte of buf){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zipBooks(entries){
 const locals=[],centrals=[];let offset=0;
 for(const {name,bytes} of entries){
  const file=Buffer.from(name),raw=Buffer.from(bytes),packed=deflateRawSync(raw),crc=crc32(raw);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(file.length,26);
  locals.push(local,file,packed);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE(offset,42);
  centrals.push(central,file);offset+=local.length+file.length+packed.length;
 }
 const centralBytes=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,...centrals,end]);
}
function freeBundlePage(lang){
 const labels={en:'DOWNLOAD ALL BOOKS',de:'ALLE BÜCHER HERUNTERLADEN','pt-PT':'DESCARREGAR TODOS OS LIVROS'};
 const title=labels[lang]||labels.en;
 return '<!doctype html><html lang="'+safe(lang)+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+title+'</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 15%,#12b7e9,transparent 45%),radial-gradient(circle at 85% 75%,#fb6f9b,transparent 45%),linear-gradient(140deg,#0b2777,#6627a7);font-family:system-ui;color:white;text-align:center}main{padding:35px 25px;max-width:720px}h1{font-size:clamp(42px,9vw,82px);line-height:1.05;text-shadow:4px 5px #142153;margin:0 0 35px}.gift{font-size:90px;margin-bottom:15px}.button{display:inline-block;background:#ffdf38;color:#142354;border-radius:60px;padding:22px 32px;font-size:clamp(20px,4vw,31px);font-weight:1000;text-decoration:none;box-shadow:0 10px #ed7e28}.button:focus-visible{outline:4px solid white}</style><main><div class="gift" aria-hidden="true">🎁📚✨</div><h1>'+title+'</h1><a class="button" href="/barber/free-bundle.zip?language='+encodeURIComponent(lang)+'">'+title+'</a></main></html>';
}

const LINK='plink_1UcgIURuZKBP2B3nCAGISBfm';
const LEGACY_LINK='plink_1UboGGRuZKBP2B3nzmcAPiQL';
const validPurchase=s=>(s.payment_link===LINK&&s.currency==='usd'&&s.amount_total===4999)||(s.payment_link===LEGACY_LINK&&s.currency==='eur'&&s.amount_total===2499);
const langs=new Set(['en','de','pt-PT']);
const REQUIRED_BUNDLE_SLUGS=['zachary-my-unique-hat-2026-11','zachary-school-that-believed-in-him','emir-boy-who-never-smiles','emir-barbershop-boys-and-salon-girls'];
const hasFullBundle=arrays=>arrays.every(slugs=>REQUIRED_BUNDLE_SLUGS.every(slug=>slugs.includes(slug)));

const hash=x=>createHash('sha256').update(x).digest('hex');
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const language=s=>s.custom_fields?.find(f=>f.key==='booklanguage')?.dropdown?.value==='de'?'de':s.custom_fields?.find(f=>f.key==='booklanguage')?.dropdown?.value==='pt'?'pt-PT':'en';
const code=(id,slot=1)=>createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET).update(slot===1?'gift:'+id:'gift2:'+id).digest('hex');
function send(res,status,body,type='text/html; charset=utf-8',referrerPolicy='no-referrer'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':referrerPolicy,'X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'});res.end(body);}
function page(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+safe(title)+'</title><style>body{background:#073d2e;color:#143d30;font:17px/1.5 system-ui;padding:20px}main{max-width:650px;margin:30px auto;padding:28px;background:#fff8e8;border-radius:18px}a{color:#006445;overflow-wrap:anywhere}.btn,button{display:inline-block;padding:12px 18px;margin:10px 0;background:#096043;color:white;border:0;border-radius:9px;text-decoration:none;cursor:pointer}input,select{display:block;padding:10px;width:95%;margin:5px 0 15px}</style><main><h1>'+safe(title)+'</h1>'+body+'</main></html>';}
async function verified(stripe,id){if(!/^cs_live_[a-zA-Z0-9]{16,200}$/.test(id||''))return null;let s;try{s=await stripe.checkout.sessions.retrieve(id);}catch(e){if(e?.type==='StripeInvalidRequestError'&&[400,404].includes(e?.statusCode))return null;throw e;}return s.livemode&&s.mode==='payment'&&s.status==='complete'&&s.payment_status==='paid'&&validPurchase(s)?s:null;}
async function titles(pool,at,lang){const q=await pool.query(`
 SELECT r.slug FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.status='published' AND r.published_at<=$1
 UNION SELECT r.slug FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.status='published' AND r.published_at<=$1
 ORDER BY slug`,[at,lang]);return q.rows.map(x=>x.slug);}
async function pdf(pool,res,slug,lang,at,disposition='attachment'){if(!/^[a-z0-9-]{3,80}$/.test(slug||''))return send(res,400,'Invalid title','text/plain');const q=await pool.query(`
 SELECT f.pdf_content FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1 AND r.status='published' AND r.published_at<=$3
 UNION ALL SELECT f.pdf_content FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1 AND r.status='published' AND r.published_at<=$3 LIMIT 1`,[slug,lang,at]);if(!q.rowCount)return send(res,404,'This book is not included in your purchased collection.','text/plain');const b=q.rows[0].pdf_content;res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':disposition+'; filename="AOM-'+slug+'-'+lang+'.pdf"','Content-Length':b.length,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(b);}
const list=(slugs,base)=>slugs.length?'<ul>'+slugs.map(s=>'<li><a class="btn" href="'+base+encodeURIComponent(s)+'">'+safe(s.replaceAll('-',' '))+' (PDF)</a></li>').join('')+'</ul>':'<p>No approved files are currently available for this language. Please contact support with your payment receipt.</p>';

const readerCopy={
 en:{save:'Be sure to download the book so you can read it again anytime.',download:'Download the book (PDF)',full:'Read full screen',more:'More books in your gift',missing:'This book is not yet available in your chosen language.'},
 de:{save:'Lade das Buch unbedingt herunter, damit du es jederzeit wieder lesen kannst.',download:'Buch herunterladen (PDF)',full:'Im Vollbild lesen',more:'Weitere Bücher in deinem Geschenk',missing:'Dieses Buch ist in deiner ausgewählten Sprache noch nicht verfügbar.'},
 'pt-PT':{save:'Não te esqueças de descarregar o livro para o poderes ler novamente sempre que quiseres.',download:'Descarregar o livro (PDF)',full:'Ler em ecrã inteiro',more:'Mais livros no teu presente',missing:'Este livro ainda não está disponível no idioma que escolheste.'}
};
export function directGiftAccess(gift){
 return createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET).update('gift-reader:'+gift).digest('hex');
}
function readerUrl(path,access,slug,inline=false){
 const params=new URLSearchParams({access});
 if(slug)params.set('slug',slug);
 if(inline)params.set('inline','1');
 return '/barber/'+path+'?'+params;
}
function giftReader(access,lang,slug){
 const copy=readerCopy[lang];
 const title=bundleTitle(slug,lang);
 const inline=readerUrl('reader-pdf',access,slug,true);
 const attach=readerUrl('reader-pdf',access,slug);
 const shelfLabel={en:'Back to your books',de:'Zurück zu deinen Büchern','pt-PT':'Voltar aos teus livros'};
 const content='<a class="btn" href="'+safe(readerUrl('books',access))+'">'+shelfLabel[lang]+'</a><p><strong>'+safe(copy.save)+'</strong></p>'+
  '<p><a class="btn" href="'+safe(attach)+'">'+safe(copy.download)+'</a> '+
  '<a class="btn" href="'+safe(inline)+'">'+safe(copy.full)+'</a></p>'+
  '<iframe title="'+safe(title)+'" src="'+safe(inline)+'" style="width:100%;height:75vh;border:0;background:#fff"></iframe>';
 return page(title,content).replace('<html lang="en">','<html lang="'+lang+'">').replace('max-width:650px','max-width:900px');
}

// Stripe-verified paid checkouts may supply two optional recipient email addresses.
// The purchase remains valid when either email is blank; the customer can share links later.
// A database update reserves each invitation slot to avoid duplicate sends on refresh.
export async function sendCheckoutGiftInvitations({pool,session,personalization=null}) {
  if(!session||!validPurchase(session)||session.livemode!==true||
     session.mode!=='payment'||session.status!=='complete'||session.payment_status!=='paid')return [];
  const id=session.id;
  if(!/^cs_live_[A-Za-z0-9]{16,200}$/.test(id||''))return [];
  const buyer=String(session.customer_details?.email||session.customer_email||'').trim().toLowerCase();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(buyer))return [];
  const paidAt=new Date(session.created*1000),g1=code(id),g2=code(id,2);
  await pool.query(`INSERT INTO aom_barber_gifts
    (session_id,purchased_at,buyer_email,buyer_language,gift_hash,gift2_hash)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (session_id) DO UPDATE
    SET gift2_hash=COALESCE(aom_barber_gifts.gift2_hash,excluded.gift2_hash)`,
    [id,paidAt,buyer,language(session),hash(g1),hash(g2)]);
  if(!mailConfigured())return [];
  const sent=[];
  for(const [slot,key,token,col] of [
    [1,'giftoneemail',g1,'gift1_invited_at'],
    [2,'gifttwoemail',g2,'gift2_invited_at']]){
    const raw=session.custom_fields?.find(f=>f.key===key)?.text?.value;
    const email=String(raw||'').trim().toLowerCase();
    if(!email)continue;
    if(email.length>254||!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)){
      console.warn('Invalid gift recipient email in checkout',slot);continue;
    }
    const reserved=await pool.query(`UPDATE aom_barber_gifts SET ${col}=now()
      WHERE session_id=$1 AND ${col} IS NULL RETURNING session_id`,[id]);
    if(!reserved.rowCount)continue;
    const url=new URL('/barber/open?gift='+token,process.env.APP_URL).href;
    try{
      await sendTransactionalMail({
        email,subject:personalization?((slot===1?personalization.recipient1_name:personalization.recipient2_name)+', '+personalization.sender_name+' from '+personalization.barber_shop_name+' sent you a gift'):'A gift for you: Authors On A Mission books',
        html:(personalization?'<p>'+safe(personalization.sender_name)+' from '+safe(personalization.barber_shop_name)+' sent '+safe(slot===1?personalization.recipient1_name:personalization.recipient2_name)+' a digital book gift!</p>':'<p>Someone has gifted you a children\'s book bundle from Authors On A Mission.</p>')+
         '<p><a href="'+safe(url)+'">Accept your free book gift</a></p>'+
         '<p>Choose your preferred reading language when you claim it. This gift is free and the link can be redeemed once.</p>'
      },'bundle-gift-invite-'+id+'-'+slot);
      sent.push(slot);
    }catch(e){
      await pool.query(`UPDATE aom_barber_gifts SET ${col}=NULL WHERE session_id=$1`,[id]);
      console.error('Gift invitation delivery failed',slot,e?.code||e?.name);
    }
  }
  return sent;
}
export async function handleBarber({req,res,url,stripe,pool}){
if(!url.pathname.startsWith('/barber/'))return false;
if(!pool){send(res,503,page('Service unavailable','Please contact support.'));return true;}
try{
const path=url.pathname,id=url.searchParams.get('session_id'),gift=url.searchParams.get('gift'),access=url.searchParams.get('access'),slug=url.searchParams.get('slug');

if(path==='/barber/free-books'&&req.method==='GET'){
 const lang=langs.has(url.searchParams.get('language'))?url.searchParams.get('language'):'en';
 send(res,200,freeBundlePage(lang));return true;
}
if(path==='/barber/free-bundle.zip'&&req.method==='GET'){
 const lang=langs.has(url.searchParams.get('language'))?url.searchParams.get('language'):'en';
 const available=await titles(pool,new Date(),lang);
 if(!available.length){send(res,503,page('Books being prepared','<p>There are no approved books ready for this language yet.</p>'));return true;}
 const entries=[];
 for(const slug of available){
  const q=await pool.query(`SELECT f.pdf_content FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1 AND r.status='published' AND r.published_at<=now()
   UNION ALL SELECT f.pdf_content FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1 AND r.status='published' AND r.published_at<=now() LIMIT 1`,[slug,lang]);
  if(q.rowCount)entries.push({name:slug+'-'+lang+'.pdf',bytes:q.rows[0].pdf_content});
 }
 if(!entries.length){send(res,503,page('Books being prepared','<p>Book files are not ready yet.</p>'));return true;}
 const zip=zipBooks(entries);
 res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="Authors-On-A-Mission-Free-Books-'+lang+'.zip"','Content-Length':zip.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(zip);return true;
}

if(path==='/barber/checkout'&&req.method==='GET'){
  const sets=await Promise.all([...langs].map(l=>titles(pool,new Date(),l)));
  const same=hasFullBundle(sets);
  if(!same){send(res,503,page('Your four-book gift bundle is being prepared','<p>We are completing the approved digital editions for English, German and Portuguese. To protect buyers, checkout is unavailable until all four books can be delivered in the selected reading language.</p><p>No payment has been taken.</p><p>For help or to request a release notification, email <a href="mailto:brathatfashionhouse@gmail.com">Authors On A Mission</a>.</p>'));return true;}
  res.writeHead(303,{'Location':'https://buy.stripe.com/14AeVfeAY2HM8fm7JLffy04','Cache-Control':'no-store'});res.end();return true;
}
if(path==='/barber/catalog-status'&&req.method==='GET'){const now=new Date();const out={};for(const lang of langs)out[lang]=await titles(pool,now,lang);send(res,200,JSON.stringify({publishedBooksByLanguage:out,requiredBundleSlugs:REQUIRED_BUNDLE_SLUGS,bundleReady:hasFullBundle(Object.values(out))}),'application/json; charset=utf-8');return true;}
if(path==='/barber/thanks'&&req.method==='GET'){
const s=await verified(stripe,id);if(!s){send(res,403,page('Payment not verified','Please complete checkout first.'));return true;}
const at=new Date(s.created*1000),lang=language(s),g=code(id),g2=code(id,2),email=(s.customer_details?.email||s.customer_email||'').toLowerCase();
await pool.query('INSERT INTO aom_barber_gifts(session_id,purchased_at,buyer_email,buyer_language,gift_hash,gift2_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(session_id) DO UPDATE SET gift2_hash=COALESCE(aom_barber_gifts.gift2_hash,EXCLUDED.gift2_hash)',[id,at,email,lang,hash(g),hash(g2)]);
const giftUrl=new URL('/barber/open?gift='+g,process.env.APP_URL).href;
const giftUrl2=new URL('/barber/open?gift='+g2,process.env.APP_URL).href;
// Recipient emails wait for a completed personalization form and permission.
try{if(email&&mailConfigured())await sendTransactionalMail({email,subject:'Your digital book bundle and personalized gift links',html:'<p>Thank you for supporting Authors On A Mission.</p><p>Your personal books: <a href="'+safe(new URL('/barber/thanks?session_id='+id,process.env.APP_URL).href)+'">Open your purchased book collection</a></p><p><strong>Personalize gifts:</strong> <a href="'+safe(new URL('/barber/setup?session_id='+id,process.env.APP_URL).href)+'">Enter sender, barbershop and recipient names</a></p><p>After you save the names, you will receive two private gift links to share.</p><p>Keep your personal receipt link private. This is a one-time purchase, not a subscription.</p>'},'bundle-buyer-two-gifts-'+id);}catch(e){console.error('Barber buyer email failed',e?.code||e?.name);}
send(res,200,page('Thank you for your purchase!','<p>Your one-time purchase is verified. Your personal downloads:</p>'+list(await titles(pool,at,lang),'/barber/pdf?session_id='+encodeURIComponent(id)+'&slug=')+'<h2>Personalize your two gifts</h2><p><a class="btn" href="'+safe(new URL('/barber/setup?session_id='+id,process.env.APP_URL).href)+'">Enter names for the gift page</a></p><p>Save the names first, then send each recipient their personalized private gift link. Each gift can be redeemed once. Keep your payment receipt private.</p>'));return true;
}
if(path==='/barber/pdf'&&req.method==='GET'){const s=await verified(stripe,id);if(!s){send(res,403,'Payment not verified','text/plain');return true;}await pdf(pool,res,slug,language(s),new Date(s.created*1000));return true;}

if(path==='/barber/redeem'&&req.method==='GET'){
 if(!/^[a-f0-9]{64}$/.test(gift||'')){send(res,404,page('Invalid gift','Gift link not found.'));return true;}
 const preferred=url.searchParams.get('language');
 const lang=langs.has(preferred)?preferred:'en';
 const bearer=directGiftAccess(gift), tokenHash=hash(gift), accessHash=hash(bearer);
 const q=await pool.query(`UPDATE aom_barber_gifts SET
    claimed_at=CASE WHEN gift_hash=$1 THEN COALESCE(claimed_at,now()) ELSE claimed_at END,
    claimed2_at=CASE WHEN gift2_hash=$1 THEN COALESCE(claimed2_at,now()) ELSE claimed2_at END,
    recipient_language=CASE WHEN gift_hash=$1 THEN COALESCE(recipient_language,$2) ELSE recipient_language END,
    recipient2_language=CASE WHEN gift2_hash=$1 THEN COALESCE(recipient2_language,$2) ELSE recipient2_language END,
    access_hash=CASE WHEN gift_hash=$1 THEN $3 ELSE access_hash END,
    access2_hash=CASE WHEN gift2_hash=$1 THEN $3 ELSE access2_hash END
    WHERE (gift_hash=$1 AND (claimed_at IS NULL OR access_hash=$3))
       OR (gift2_hash=$1 AND (claimed2_at IS NULL OR access2_hash=$3))
    RETURNING session_id`,[tokenHash,lang,accessHash]);
 if(!q.rowCount){send(res,409,page('Gift unavailable','Use the private book link from your gift email if you already claimed this gift.'));return true;}
 const dest=readerUrl('books',bearer);
 res.writeHead(303,{'Location':dest,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
}
if((path==='/barber/books'||path==='/barber/reader'||path==='/barber/reader-pdf')&&req.method==='GET'){
 if(!/^[a-f0-9]{64}$/.test(access||'')){send(res,403,'Invalid gift access','text/plain');return true;}
 const q=await pool.query('SELECT CASE WHEN access_hash=$1 THEN recipient_language ELSE recipient2_language END AS recipient_language FROM aom_barber_gifts WHERE (access_hash=$1 AND claimed_at IS NOT NULL) OR (access2_hash=$1 AND claimed2_at IS NOT NULL)',[hash(access)]);
 if(!q.rowCount){send(res,403,'Gift access unavailable','text/plain');return true;}
 const lang=q.rows[0].recipient_language, at=new Date();
 if(!langs.has(lang)){send(res,403,'Gift language unavailable','text/plain');return true;}
 if(path==='/barber/reader-pdf'){
  if(!isBundleBook(slug)){send(res,404,'This book is not included in your gift.','text/plain');return true;}
  await pdf(pool,res,slug,lang,at,url.searchParams.get('inline')==='1'?'inline':'attachment');
  return true;
 }
 const available=(await titles(pool,at,lang)).filter(isBundleBook);
 if(path==='/barber/books'){
  const otherEditions=(await Promise.all([...langs].filter(l=>l!==lang).map(l=>titles(pool,at,l)))).flat().filter(isBundleBook);
  send(res,200,shelfPage({lang,available,otherEditions,link:(view,book)=>readerUrl(view,access,book)}));return true;
 }
 const book=slug||available[0];
 if(!available.includes(book)){
  send(res,404,page('Book unavailable',safe(readerCopy[lang].missing)));return true;
 }
 send(res,200,giftReader(access,lang,book));return true;
}
if(path==='/barber/redeem'&&req.method==='POST'){
const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){send(res,413,'Too large','text/plain');return true;}chunks.push(chunk);}
const f=new URLSearchParams(Buffer.concat(chunks).toString()),g=f.get('gift')||'',email=(f.get('email')||'').trim().toLowerCase(),lang=f.get('language')||'';
if(!/^[a-f0-9]{64}$/.test(g)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!langs.has(lang)){send(res,400,page('Invalid details','Check your gift, email and language.'));return true;}
const bearer=randomBytes(32).toString('hex');
const q=await pool.query(`UPDATE aom_barber_gifts SET
 claimed_at=CASE WHEN gift_hash=$1 THEN now() ELSE claimed_at END,
 claimed2_at=CASE WHEN gift2_hash=$1 THEN now() ELSE claimed2_at END,
 recipient_email=CASE WHEN gift_hash=$1 THEN $2 ELSE recipient_email END,
 recipient2_email=CASE WHEN gift2_hash=$1 THEN $2 ELSE recipient2_email END,
 recipient_language=CASE WHEN gift_hash=$1 THEN $3 ELSE recipient_language END,
 recipient2_language=CASE WHEN gift2_hash=$1 THEN $3 ELSE recipient2_language END,
 access_hash=CASE WHEN gift_hash=$1 THEN $4 ELSE access_hash END,
 access2_hash=CASE WHEN gift2_hash=$1 THEN $4 ELSE access2_hash END
 WHERE (gift_hash=$1 AND claimed_at IS NULL) OR (gift2_hash=$1 AND claimed2_at IS NULL) RETURNING session_id`,[hash(g),email,lang,hash(bearer)]);
if(!q.rowCount){send(res,409,page('Already redeemed','This gift has already been claimed.'));return true;}
const link=new URL('/barber/books?access='+bearer,process.env.APP_URL).href;
try{if(mailConfigured())await sendTransactionalMail({email,subject:'Your Authors On A Mission book gift',html:'<p>Open your private gifted books here: <a href="'+safe(link)+'">Download your books</a></p>'},'bundle-gift-'+q.rows[0].session_id+'-'+hash(g));}catch(e){console.error('Gift mail failed',e?.code||e?.name);}
send(res,200,page('Your gift is ready','<p>Save this personal access link. Only you should use it.</p><p><a class="btn" href="'+safe(link)+'">Open my free books</a></p>'));return true;
}
if(path==='/barber/gift-pdf'&&req.method==='GET'){
if(!/^[a-f0-9]{64}$/.test(access||'')){send(res,403,'Invalid gift access','text/plain');return true;}
const q=await pool.query('SELECT purchased_at,CASE WHEN access_hash=$1 THEN recipient_language ELSE recipient2_language END AS recipient_language FROM aom_barber_gifts WHERE (access_hash=$1 AND claimed_at IS NOT NULL) OR (access2_hash=$1 AND claimed2_at IS NOT NULL)',[hash(access)]);
if(!q.rowCount){send(res,403,'Gift access unavailable','text/plain');return true;}
const p=q.rows[0];await pdf(pool,res,slug,p.recipient_language,p.purchased_at);return true;
}
return false;
}catch(e){console.error('Barber redemption failed',e?.code||e?.name);send(res,503,page('Temporary error','Please retry using the original link.'));return true;}
}
