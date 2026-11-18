import {createHash,createHmac,randomBytes} from 'node:crypto';
import {sendTransactionalMail,mailConfigured} from './mail.mjs';
import {bundleTitle,isBundleBook,shelfPage} from './gift-shelf.mjs';
import {approvedLanguageBooks,sendApprovedPdf,sendLanguageZip,freeLibrary,freeBookInfo,sendFreeBook} from './storybook-gifts.mjs';
import {readerPage,shelfScript,pdfjsAsset,PDFJS_VERSION} from './free-reader.mjs';

const LINK='plink_1UcgIURuZKBP2B3nCAGISBfm';
const LEGACY_LINK='plink_1UboGGRuZKBP2B3nzmcAPiQL';
const validPurchase=s=>(s.payment_link===LINK&&s.currency==='usd'&&s.amount_total===4999)||(s.payment_link===LEGACY_LINK&&s.currency==='eur'&&s.amount_total===2499);
const langs=new Set(['en','de','pt-PT']);
const giftLanguages=new Set(['en','de','fr','es','tr','pt-PT']);
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
async function approvedPdf(pool,res,slug,lang,inline=false){
 if(!isBundleBook(slug)||!(await approvedLanguageBooks(pool,lang)).includes(slug))return send(res,404,'This book is not included in your collection.','text/plain');
 await sendApprovedPdf(pool,res,slug,lang,inline);
}
const list=(slugs,base)=>slugs.length?'<ul>'+slugs.map(s=>'<li><a class="btn" href="'+base+encodeURIComponent(s)+'">'+safe(bundleTitle(s,'en'))+' (PDF)</a></li>').join('')+'</ul>':'<p>No approved files are currently available for this language. Please contact support with your payment receipt.</p>';

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

// Barbershop QR gift (owner-approved free gift): the parent scans the QR on the
// barber's wall, the child picks one of six languages on the gift page, and
// "Open Your Gift" downloads that language's approved, numbered bundle.
// Read online: the gift pages show every approved book per language; children
// read in the browser (page by page) or save a single book.
if(path==='/barber/free-library'&&req.method==='GET'){
 const data=await freeLibrary(pool,[...giftLanguages]);
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify({languages:data}));return true;
}
if(path.startsWith('/barber/pdfjs/'+PDFJS_VERSION+'/')&&req.method==='GET'){
 const body=await pdfjsAsset(path.split('/').pop());
 if(!body){send(res,404,'Not found','text/plain');return true;}
 res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Length':body.length,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});
 res.end(body);return true;
}
if(path==='/barber/shelf.js'&&req.method==='GET'){
 res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
 res.end(shelfScript);return true;
}
if((path==='/barber/free-book.pdf'||path==='/barber/read')&&(req.method==='GET'||req.method==='HEAD')){
 const lang=url.searchParams.get('language');
 if(!giftLanguages.has(lang)||!isBundleBook(slug)){send(res,404,'Book unavailable','text/plain; charset=utf-8');return true;}
 if(path==='/barber/read'){
  const book=await freeBookInfo(pool,slug,lang);
  if(!book){send(res,404,page('Book unavailable','<p>This book is not available in this language yet.</p>'));return true;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300','Referrer-Policy':'strict-origin','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'});
  res.end(req.method==='HEAD'?'':readerPage(book));return true;
 }
 try{await sendFreeBook(pool,req,res,slug,lang,url.searchParams.get('download')==='1');}
 catch(e){console.error('Free book failed',e?.code||e?.name);if(!res.headersSent)send(res,500,'Book unavailable','text/plain');else res.destroy();}
 return true;
}
if(path==='/barber/free-bundle.zip'&&req.method==='GET'){
 const lang=url.searchParams.get('language');
 if(!giftLanguages.has(lang)){send(res,400,'Choose English, Deutsch, Français, Español, Türkçe or Português.','text/plain; charset=utf-8');return true;}
 try{await sendLanguageZip(pool,res,lang);}
 catch(e){console.error('Barber QR gift ZIP failed',e?.code||e?.name);if(!res.headersSent)send(res,500,'Download unavailable','text/plain');else res.destroy();}
 return true;
}
if(path==='/barber/free-books'&&req.method==='GET'){
 res.writeHead(303,{'Location':'https://www.theauthorsmission.de/gift.html','Cache-Control':'no-store'});res.end();return true;
}

// Standalone retail bundle: no gift links or barbershop personalization.
const RETAIL_LINK='plink_1UcgSgRuZKBP2B3nsT0qp29N';
const retailPaid=session=>session&&session.livemode===true&&session.mode==='payment'&&session.status==='complete'&&session.payment_status==='paid'&&session.payment_link===RETAIL_LINK&&session.currency==='usd'&&session.amount_total===4999;
if(path==='/barber/bundle-checkout'&&req.method==='GET'){
 const selected=langs.has(url.searchParams.get('language'))?url.searchParams.get('language'):'en';
 const available=await titles(pool,new Date(),selected);
 if(available.length<12){
  send(res,200,page('Digital book bundle — $49.99 USD','<p><strong>One-time price: $49.99 USD.</strong> The complete 12-book collection is not yet ready in the selected language. Purchasing is paused so you will not be charged for unavailable books.</p><p>Available approved titles in '+safe(selected)+': '+available.length+' of 12. Please return when the collection is ready.</p><p><a href="https://www.theauthorsmission.de/">Back to Authors On A Mission</a></p>'));return true;
 }
 res.writeHead(303,{'Location':'https://buy.stripe.com/14A4gBdwU1DIanu4xzffy05','Cache-Control':'no-store'});res.end();return true;
}
if((path==='/barber/bundle-thanks'||path==='/barber/bundle-pdf')&&req.method==='GET'){
 let session;
 try{session=await stripe.checkout.sessions.retrieve(id||'');}catch(e){if(e?.type==='StripeInvalidRequestError'&&[400,404].includes(e?.statusCode)){send(res,403,page('Payment not verified','Please complete the purchase first.'));return true;}throw e;}
 if(!retailPaid(session)){send(res,403,page('Payment not verified','A verified $49.99 USD retail bundle purchase is required.'));return true;}
 const at=new Date(session.created*1000),lang=language(session);
 if(path==='/barber/bundle-pdf'){await approvedPdf(pool,res,slug,lang);return true;}
 const books=await approvedLanguageBooks(pool,lang);
 send(res,200,page('Your purchased digital book bundle','<p>Thank you for your one-time $49.99 USD purchase. Download your books in your chosen language:</p>'+list(books,'/barber/bundle-pdf?session_id='+encodeURIComponent(id)+'&slug=')+'<p>Keep this receipt page private to protect your downloads.</p>'));return true;
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
send(res,200,page('Thank you for your purchase!','<p>Your one-time purchase is verified. Your personal downloads:</p>'+list(await approvedLanguageBooks(pool,lang),'/barber/pdf?session_id='+encodeURIComponent(id)+'&slug=')+'<h2>Personalize your two gifts</h2><p><a class="btn" href="'+safe(new URL('/barber/setup?session_id='+id,process.env.APP_URL).href)+'">Enter names for the gift page</a></p><p>Save the names first, then send each recipient their personalized private gift link. Each gift can be redeemed once. Keep your payment receipt private.</p>'));return true;
}
if(path==='/barber/pdf'&&req.method==='GET'){const s=await verified(stripe,id);if(!s){send(res,403,'Payment not verified','text/plain');return true;}await approvedPdf(pool,res,slug,language(s));return true;}

if(path==='/barber/redeem'&&req.method==='GET'){
 if(!/^[a-f0-9]{64}$/.test(gift||'')){send(res,404,page('Invalid gift','Gift link not found.'));return true;}
 const preferred=url.searchParams.get('language');
 // Purchased-gift claims store en/de/pt-PT; the other gift languages download directly.
 if(url.searchParams.get('download')==='1'&&giftLanguages.has(preferred)&&!langs.has(preferred)){
  res.writeHead(303,{'Location':'/barber/free-bundle.zip?language='+encodeURIComponent(preferred),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
 }
 const lang=langs.has(preferred)?preferred:'en';
 const bearer=directGiftAccess(gift), tokenHash=hash(gift), accessHash=hash(bearer);
 const q=await pool.query(`UPDATE aom_barber_gifts SET
    claimed_at=CASE WHEN gift_hash=$1 THEN COALESCE(claimed_at,now()) ELSE claimed_at END,
    claimed2_at=CASE WHEN gift2_hash=$1 THEN COALESCE(claimed2_at,now()) ELSE claimed2_at END,
    recipient_language=CASE WHEN gift_hash=$1 THEN $2 ELSE recipient_language END,
    recipient2_language=CASE WHEN gift2_hash=$1 THEN $2 ELSE recipient2_language END,
    access_hash=CASE WHEN gift_hash=$1 THEN $3 ELSE access_hash END,
    access2_hash=CASE WHEN gift2_hash=$1 THEN $3 ELSE access2_hash END
    WHERE (gift_hash=$1 AND (claimed_at IS NULL OR access_hash=$3))
       OR (gift2_hash=$1 AND (claimed2_at IS NULL OR access2_hash=$3))
    RETURNING session_id`,[tokenHash,lang,accessHash]);
 if(!q.rowCount){send(res,409,page('Gift unavailable','Use the private book link from your gift email if you already claimed this gift.'));return true;}
 const dest=url.searchParams.get('download')==='1'?readerUrl('download',bearer):readerUrl('books',bearer);
 res.writeHead(303,{'Location':dest,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
}
if((path==='/barber/books'||path==='/barber/reader'||path==='/barber/reader-pdf'||path==='/barber/download')&&req.method==='GET'){
 if(!/^[a-f0-9]{64}$/.test(access||'')){send(res,403,'Invalid gift access','text/plain');return true;}
 const q=await pool.query('SELECT CASE WHEN access_hash=$1 THEN recipient_language ELSE recipient2_language END AS recipient_language FROM aom_barber_gifts WHERE (access_hash=$1 AND claimed_at IS NOT NULL) OR (access2_hash=$1 AND claimed2_at IS NOT NULL)',[hash(access)]);
 if(!q.rowCount){send(res,403,'Gift access unavailable','text/plain');return true;}
 const lang=q.rows[0].recipient_language, at=new Date();
 if(!langs.has(lang)){send(res,403,'Gift language unavailable','text/plain');return true;}
 if(path==='/barber/download'){
  try{await sendLanguageZip(pool,res,lang);}
  catch(e){console.error('Barber gift ZIP failed',e?.code||e?.name);if(!res.headersSent)send(res,500,'Download unavailable','text/plain');else res.destroy();}
  return true;
 }
 if(path==='/barber/reader-pdf'){
  if(!isBundleBook(slug)){send(res,404,'This book is not included in your gift.','text/plain');return true;}
  await approvedPdf(pool,res,slug,lang,url.searchParams.get('inline')==='1');
  return true;
 }
 const available=await approvedLanguageBooks(pool,lang);
 if(path==='/barber/books'){
  const zipLabel={en:'Download all books (ZIP)',de:'Alle Bücher herunterladen (ZIP)','pt-PT':'Descarregar todos os livros (ZIP)'}[lang];
  const bulk=available.length?'<div style="background:#fff2cc;text-align:center;padding:14px"><a class="button" href="'+safe(readerUrl('download',access))+'">'+zipLabel+' ('+available.length+')</a></div>':'';
  send(res,200,shelfPage({lang,available,otherEditions:[],order:available,link:(view,book)=>readerUrl(view,access,book)}).replace('<ul class="books">',()=>bulk+'<ul class="books">'));return true;
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
const p=q.rows[0];await approvedPdf(pool,res,slug,p.recipient_language);return true;
}
return false;
}catch(e){console.error('Barber redemption failed',e?.code||e?.name);send(res,503,page('Temporary error','Please retry using the original link.'));return true;}
}
