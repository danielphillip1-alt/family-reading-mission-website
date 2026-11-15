import {createHash,createHmac,randomBytes} from 'node:crypto';
import {sendTransactionalMail,mailConfigured} from './mail.mjs';
const LINK='plink_1UboGGRuZKBP2B3nzmcAPiQL';
const langs=new Set(['en','de','pt-PT']);
const hash=x=>createHash('sha256').update(x).digest('hex');
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const language=s=>s.custom_fields?.find(f=>f.key==='booklanguage')?.dropdown?.value==='de'?'de':s.custom_fields?.find(f=>f.key==='booklanguage')?.dropdown?.value==='pt'?'pt-PT':'en';
const code=(id,slot=1)=>createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET).update(slot===1?'gift:'+id:'gift2:'+id).digest('hex');
function send(res,status,body,type='text/html; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'});res.end(body);}
function page(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+safe(title)+'</title><style>body{background:#073d2e;color:#143d30;font:17px/1.5 system-ui;padding:20px}main{max-width:650px;margin:30px auto;padding:28px;background:#fff8e8;border-radius:18px}a{color:#006445;overflow-wrap:anywhere}.btn,button{display:inline-block;padding:12px 18px;margin:10px 0;background:#096043;color:white;border:0;border-radius:9px;text-decoration:none;cursor:pointer}input,select{display:block;padding:10px;width:95%;margin:5px 0 15px}</style><main><h1>'+safe(title)+'</h1>'+body+'</main></html>';}
async function verified(stripe,id){if(!/^cs_live_[a-zA-Z0-9]{16,200}$/.test(id||''))return null;let s;try{s=await stripe.checkout.sessions.retrieve(id);}catch(e){if(e?.type==='StripeInvalidRequestError'&&[400,404].includes(e?.statusCode))return null;throw e;}return s.livemode&&s.mode==='payment'&&s.status==='complete'&&s.payment_status==='paid'&&s.payment_link===LINK&&s.currency==='eur'&&s.amount_total===2499?s:null;}
async function titles(pool,at,lang){const q=await pool.query("SELECT r.slug FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.status='published' AND r.published_at<=$1 ORDER BY r.slug",[at,lang]);return q.rows.map(x=>x.slug);}
async function pdf(pool,res,slug,lang,at){if(!/^[a-z0-9-]{3,80}$/.test(slug||''))return send(res,400,'Invalid title','text/plain');const q=await pool.query("SELECT f.pdf_content FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$2 AND e.approved_at IS NOT NULL JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1 AND r.status='published' AND r.published_at<=$3 LIMIT 1",[slug,lang,at]);if(!q.rowCount)return send(res,404,'This book is not included in your purchased collection.','text/plain');const b=q.rows[0].pdf_content;res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="AOM-'+slug+'-'+lang+'.pdf"','Content-Length':b.length,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(b);}
const list=(slugs,base)=>slugs.length?'<ul>'+slugs.map(s=>'<li><a class="btn" href="'+base+encodeURIComponent(s)+'">'+safe(s.replaceAll('-',' '))+' (PDF)</a></li>').join('')+'</ul>':'<p>No approved files are currently available for this language. Please contact support with your payment receipt.</p>';
// Stripe-verified paid checkouts may supply two optional recipient email addresses.
// The purchase remains valid when either email is blank; the customer can share links later.
// A database update reserves each invitation slot to avoid duplicate sends on refresh.
export async function sendCheckoutGiftInvitations({pool,session,personalization=null}) {
  if(!session||session.payment_link!==LINK||session.livemode!==true||
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
if(!stripe||!pool){send(res,503,page('Service unavailable','Please contact support.'));return true;}
try{
const path=url.pathname,id=url.searchParams.get('session_id'),gift=url.searchParams.get('gift'),access=url.searchParams.get('access'),slug=url.searchParams.get('slug');
if(path==='/barber/checkout'&&req.method==='GET'){
  const sets=await Promise.all([...langs].map(l=>titles(pool,new Date(),l)));
  const adequate=sets.every(arr=>arr.length>=4);
  const same=adequate&&sets.every(arr=>arr.slice().sort().join('|')===sets[0].slice().sort().join('|'));
  if(!same){send(res,503,page('Your four-book gift bundle is being prepared','<p>We are completing the approved digital editions for English, German and Portuguese. To protect buyers, checkout is unavailable until all four books can be delivered in the selected reading language.</p><p>No payment has been taken.</p><p>For help or to request a release notification, email <a href="mailto:brathatfashionhouse@gmail.com">Authors On A Mission</a>.</p>'));return true;}
  res.writeHead(303,{'Location':'https://buy.stripe.com/14AdRbcsQ96aeDKe89ffy03','Cache-Control':'no-store'});res.end();return true;
}
if(path==='/barber/catalog-status'&&req.method==='GET'){const now=new Date();const out={};for(const lang of langs)out[lang]=await titles(pool,now,lang);send(res,200,JSON.stringify({publishedBooksByLanguage:out}),'application/json; charset=utf-8');return true;}
if(path==='/barber/thanks'&&req.method==='GET'){
const s=await verified(stripe,id);if(!s){send(res,403,page('Payment not verified','Please complete checkout first.'));return true;}
const at=new Date(s.created*1000),lang=language(s),g=code(id),g2=code(id,2),email=(s.customer_details?.email||s.customer_email||'').toLowerCase();
await pool.query('INSERT INTO aom_barber_gifts(session_id,purchased_at,buyer_email,buyer_language,gift_hash,gift2_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(session_id) DO UPDATE SET gift2_hash=COALESCE(aom_barber_gifts.gift2_hash,EXCLUDED.gift2_hash)',[id,at,email,lang,hash(g),hash(g2)]);
const giftUrl=new URL('/barber/open?gift='+g,process.env.APP_URL).href;
const giftUrl2=new URL('/barber/open?gift='+g2,process.env.APP_URL).href;
// Recipient emails wait for a completed personalization form and permission.
try{if(email&&mailConfigured())await sendTransactionalMail({email,subject:'Your digital book bundle and personalized gift links',html:'<p>Thank you for supporting Authors On A Mission.</p><p>Your personal books: <a href="'+safe(new URL('/barber/thanks?session_id='+id,process.env.APP_URL).href)+'">Open your purchased book collection</a></p><p><strong>Personalize gifts:</strong> <a href="'+safe(new URL('/barber/setup?session_id='+id,process.env.APP_URL).href)+'">Enter sender, barbershop and recipient names</a></p><p>After you save the names, you will receive two private gift links to share.</p><p>Keep your personal receipt link private. This is a one-time purchase, not a subscription.</p>'},'bundle-buyer-two-gifts-'+id);}catch(e){console.error('Barber buyer email failed',e?.code||e?.name);}
send(res,200,page('Thank you for your purchase!','<p>Your one-time €24.99 purchase is verified. Your personal downloads:</p>'+list(await titles(pool,at,lang),'/barber/pdf?session_id='+encodeURIComponent(id)+'&slug=')+'<h2>Personalize your two gifts</h2><p><a class="btn" href="'+safe(new URL('/barber/setup?session_id='+id,process.env.APP_URL).href)+'">Enter names for the gift page</a></p><p>Save the names first, then send each recipient their personalized private gift link. Each gift can be redeemed once. Keep your payment receipt private.</p>'));return true;
}
if(path==='/barber/pdf'&&req.method==='GET'){const s=await verified(stripe,id);if(!s){send(res,403,'Payment not verified','text/plain');return true;}await pdf(pool,res,slug,language(s),new Date(s.created*1000));return true;}
if(path==='/barber/redeem'&&req.method==='GET'){
if(!/^[a-f0-9]{64}$/.test(gift||'')){send(res,404,page('Invalid gift','Gift link not found.'));return true;}
const q=await pool.query('SELECT CASE WHEN gift_hash=$1 THEN claimed_at ELSE claimed2_at END AS claimed_at FROM aom_barber_gifts WHERE gift_hash=$1 OR gift2_hash=$1',[hash(gift)]);
if(!q.rowCount||q.rows[0].claimed_at){send(res,409,page('Gift unavailable','This gift was already claimed or is invalid.'));return true;}
const preferred=url.searchParams.get('language')||'en';
send(res,200,page('Claim your free book gift','<p>Someone has sent you a digital book gift. Choose one language. No payment required.</p><form method="post" action="/barber/redeem"><input type="hidden" name="gift" value="'+safe(gift)+'"><label>Email for your access link<input required type="email" name="email" maxlength="254"></label><label>Language<select name="language"><option value="en"'+(preferred==='en'?' selected':'')+'>English</option><option value="de"'+(preferred==='de'?' selected':'')+'>Deutsch</option><option value="pt-PT"'+(preferred==='pt-PT'?' selected':'')+'>Português</option></select></label><button>Redeem once</button></form><small>Email is for book delivery, not marketing.</small>'));return true;
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
if((path==='/barber/books'||path==='/barber/gift-pdf')&&req.method==='GET'){
if(!/^[a-f0-9]{64}$/.test(access||'')){send(res,403,'Invalid gift access','text/plain');return true;}
const q=await pool.query('SELECT purchased_at,CASE WHEN access_hash=$1 THEN recipient_language ELSE recipient2_language END AS recipient_language FROM aom_barber_gifts WHERE (access_hash=$1 AND claimed_at IS NOT NULL) OR (access2_hash=$1 AND claimed2_at IS NOT NULL)',[hash(access)]);
if(!q.rowCount){send(res,403,'Gift access unavailable','text/plain');return true;}
const p=q.rows[0];if(path==='/barber/gift-pdf'){await pdf(pool,res,slug,p.recipient_language,p.purchased_at);return true;}
send(res,200,page('Your gifted books','<p>Your book collection in your selected language:</p>'+list(await titles(pool,p.purchased_at,p.recipient_language),'/barber/gift-pdf?access='+access+'&slug=')));return true;
}
return false;
}catch(e){console.error('Barber redemption failed',e?.code||e?.name);send(res,503,page('Temporary error','Please retry using the original link.'));return true;}
}
