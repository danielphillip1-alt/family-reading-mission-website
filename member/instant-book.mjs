const MONTHLY_LINK='plink_1UbGQ6RuZKBP2B3nVEKI0Y7h';
const ONE_TIME_LINK='plink_1UbnI3RuZKBP2B3nC5X50brU';
const LEGACY_ANNUAL_LINK='plink_1UbOT5RuZKBP2B3nKgZfg1ie';
const VALID_LINKS=new Set([MONTHLY_LINK,ONE_TIME_LINK,LEGACY_ANNUAL_LINK]);
function selectedLanguage(session){const v=session.custom_fields?.find(f=>f.key==='booklanguage')?.dropdown?.value;return v==='pt'?'pt-PT':LANGUAGES.includes(v)?v:'en';}
const LANGUAGES=['en','de','pt-PT'];
export async function verifiedPaidCheckout(stripe,id){
 if(!stripe||typeof id!=='string'||!/^cs_live_[A-Za-z0-9]{20,180}$/.test(id))return null;
 const session=await stripe.checkout.sessions.retrieve(id);
 if(!session.livemode||!VALID_LINKS.has(session.payment_link)||session.status!=='complete'||session.payment_status!=='paid')return null;
 if(session.payment_link===ONE_TIME_LINK) {
   if(session.mode!=='payment'||!session.created)return null;
   const end=new Date(session.created*1000);
   end.setUTCMonth(end.getUTCMonth()+12);
   if(end.getTime()<=Date.now())return null;
   return {session,subscription:null,oneTime:true,accessEnd:end};
 }
 if(session.mode!=='subscription')return null;
 const sid=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
 if(!sid)return null;
 const subscription=await stripe.subscriptions.retrieve(sid);
 const end=subscription.items?.data?.[0]?.current_period_end??subscription.current_period_end;
 if(!['active','trialing'].includes(subscription.status)||!end||end*1000<=Date.now())return null;
 return {session,subscription,oneTime:false,accessEnd:new Date(end*1000)};
}
export async function handlePurchaseDelivery({req,res,url,stripe,pool}){
 if(req.method!=='GET'||!['/purchase-success','/purchase-book','/purchase-manage'].includes(url.pathname))return false;
 const id=url.searchParams.get('session_id');
 let record;
 try{record=await verifiedPaidCheckout(stripe,id)}catch(e){console.error('Stripe entitlement check failed',e?.code||e?.name)}
 const common={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 if(!record){res.writeHead(403,{...common,'Content-Type':'text/plain'});res.end('Payment not verified. Return after completing checkout.');return true;}
 if(url.pathname==='/purchase-manage'){
  if(record.oneTime){res.writeHead(303,{...common,Location:'/purchase-success?session_id='+encodeURIComponent(id)});res.end();return true;}
  const customer=typeof record.session.customer==='string'?record.session.customer:record.session.customer?.id;
  if(!customer||!process.env.STRIPE_PORTAL_CONFIGURATION_ID){res.writeHead(503,common);res.end('Membership management is temporarily unavailable');return true;}
  const portal=await stripe.billingPortal.sessions.create({customer,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID,
    return_url:new URL('/purchase-success?session_id='+encodeURIComponent(id),process.env.APP_URL).href});
  res.writeHead(303,{...common,Location:portal.url});res.end();return true;
 }
 if(url.pathname==='/purchase-book'){
  const lang=url.searchParams.get('lang');
  const slug=url.searchParams.get('slug')||'zachary-my-unique-hat-2026-11';
  if(!/^[a-z0-9-]{3,80}$/.test(slug)){res.writeHead(400,common);res.end('Invalid book');return true;}
  if(!LANGUAGES.includes(lang)||lang!==selectedLanguage(record.session)){res.writeHead(403,common);res.end('Only your chosen language is available for this purchase.');return true;}
  const q=await pool.query(`SELECT b.pdf_content FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$1 AND e.approved_at IS NOT NULL
    JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
    WHERE r.status='published' AND r.published_at<=now() AND r.slug=$2 AND
      r.published_at >= date_trunc('year',now()-interval '10 months') + interval '10 months' LIMIT 1`,
    [lang,slug]);
  if(!q.rowCount){res.writeHead(503,common);res.end('Your book is being prepared. Please try again.');return true;}
  const pdf=q.rows[0].pdf_content;
  res.writeHead(200,{...common,'Content-Type':'application/pdf',
   'Content-Disposition':'attachment; filename="Authors_On_A_Mission_'+slug+'_'+lang+'.pdf"',
   'Content-Length':pdf.length});res.end(pdf);return true;
 }
 const sid=encodeURIComponent(id);
 const preferred=selectedLanguage(record.session);
 const q=await pool.query(`SELECT r.slug,e.language,r.published_at FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id AND e.approved_at IS NOT NULL
    JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
    WHERE r.status='published' AND r.published_at<=now()
      AND r.published_at >= date_trunc('year',now()-interval '10 months') + interval '10 months'
    ORDER BY r.published_at ASC`);
 const labels={en:'English',de:'Deutsch','pt-PT':'Português'};
 const byRelease=new Map();
 for(const item of q.rows){
   const slug=typeof item.slug==='string' && /^[a-z0-9-]{3,80}$/.test(item.slug)
     ? item.slug : 'zachary-my-unique-hat-2026-11';
   if(!byRelease.has(slug))byRelease.set(slug,new Set());
   byRelease.get(slug).add(item.language);
 }
 const links=[...byRelease].map(([slug,available],index)=>{
   const title=slug==='zachary-my-unique-hat-2026-11'?'Book One — Zachary and the My Unique Hat':'Book '+(index+1)+' — '+slug.replaceAll('-',' ');
   const buttons=LANGUAGES.filter(l=>l===preferred&&available.has(l)).map(l=>
      '<a class="button '+(l===preferred?'preferred':'')+'" href="/purchase-book?session_id='+sid+
      '&amp;slug='+encodeURIComponent(slug)+'&amp;lang='+encodeURIComponent(l)+
      '">Download full book — '+labels[l]+' (PDF)</a>').join('');
   return '<h2>'+title+'</h2>'+buttons;
 }).join('');
 const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your books | Authors On A Mission</title><style>body{font:18px/1.5 system-ui,Arial,sans-serif;background:#fff3d7;color:#073d2e;padding:25px}main{max-width:580px;margin:auto;padding:26px;background:white;border-radius:16px}.button{display:block;margin:12px 0;padding:15px;border-radius:10px;background:#073d2e;color:white;text-decoration:none;font-weight:700}.preferred{background:#087d40}small{color:#53635b}</style><main><h1>Welcome to Authors On A Mission!</h1><p>Your ${record.oneTime?'one-time payment':'subscription payment'} has been verified. Download the available books in your selected language:</p>${links||'<p>Your book is being prepared. Please check back shortly.</p>'}<p><small>${record.oneTime?'You paid once for twelve months of access. No automatic renewal.':'Your monthly membership renews until cancelled.'} Keep this private checkout confirmation link to return while your access is active.</small></p>${record.oneTime?'':'<a href="/purchase-manage?session_id='+sid+'">Manage or cancel your monthly membership</a>'}</main></html>`;
 res.writeHead(200,{...common,'Content-Type':'text/html; charset=utf-8'});res.end(page);return true;
}
