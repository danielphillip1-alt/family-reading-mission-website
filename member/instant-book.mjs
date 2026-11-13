const VALID_LINKS=new Set(['plink_1UbGQ6RuZKBP2B3nVEKI0Y7h','plink_1UbOT5RuZKBP2B3nKgZfg1ie']);
const LANGUAGES=['en','de','pt-PT'];
export async function verifiedPaidCheckout(stripe,id){
 if(!stripe||typeof id!=='string'||!/^cs_live_[A-Za-z0-9]{20,180}$/.test(id))return null;
 const session=await stripe.checkout.sessions.retrieve(id);
 if(!session.livemode||!VALID_LINKS.has(session.payment_link)||session.status!=='complete'||
    session.payment_status!=='paid'||session.mode!=='subscription')return null;
 const sid=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
 if(!sid)return null;
 const subscription=await stripe.subscriptions.retrieve(sid);
 const end=subscription.items?.data?.[0]?.current_period_end??subscription.current_period_end;
 if(!['active','trialing'].includes(subscription.status)||!end||end*1000<=Date.now())return null;
 return {session,subscription};
}
export async function handlePurchaseDelivery({req,res,url,stripe,pool}){
 if(req.method!=='GET'||!['/purchase-success','/purchase-book','/purchase-manage'].includes(url.pathname))return false;
 const id=url.searchParams.get('session_id');
 let record;
 try{record=await verifiedPaidCheckout(stripe,id)}catch(e){console.error('Stripe entitlement check failed',e?.code||e?.name)}
 const common={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 if(!record){res.writeHead(403,{...common,'Content-Type':'text/plain'});res.end('Payment not verified. Return after completing checkout.');return true;}
 if(url.pathname==='/purchase-manage'){
  const customer=typeof record.session.customer==='string'?record.session.customer:record.session.customer?.id;
  if(!customer||!process.env.STRIPE_PORTAL_CONFIGURATION_ID){res.writeHead(503,common);res.end('Membership management is temporarily unavailable');return true;}
  const portal=await stripe.billingPortal.sessions.create({customer,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID,
    return_url:new URL('/purchase-success?session_id='+encodeURIComponent(id),process.env.APP_URL).href});
  res.writeHead(303,{...common,Location:portal.url});res.end();return true;
 }
 if(url.pathname==='/purchase-book'){
  const lang=url.searchParams.get('lang');
  if(!LANGUAGES.includes(lang)){res.writeHead(400,common);res.end('Invalid language');return true;}
  const q=await pool.query(`SELECT b.pdf_content FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$1 AND e.approved_at IS NOT NULL
    JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
    WHERE r.status='published' AND r.published_at<=now() AND r.slug=$2 LIMIT 1`,
    [lang,'zachary-my-unique-hat-2026-11']);
  if(!q.rowCount){res.writeHead(503,common);res.end('Your book is being prepared. Please try again.');return true;}
  const pdf=q.rows[0].pdf_content;
  res.writeHead(200,{...common,'Content-Type':'application/pdf',
   'Content-Disposition':'attachment; filename="Zachary_My_Unique_Book_One_'+lang+'.pdf"',
   'Content-Length':pdf.length});res.end(pdf);return true;
 }
 const sid=encodeURIComponent(id);
 const field=record.session.custom_fields?.find(f=>f.key==='booklanguage');
 const selected=field?.dropdown?.value;
 const preferred=selected==='pt'?'pt-PT':LANGUAGES.includes(selected)?selected:'en';
 const q=await pool.query(`SELECT e.language FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id AND e.approved_at IS NOT NULL
    JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
    WHERE r.status='published' AND r.slug=$1`,['zachary-my-unique-hat-2026-11']);
 const available=new Set(q.rows.map(x=>x.language));
 const labels={en:'English',de:'Deutsch','pt-PT':'Português'};
 const links=LANGUAGES.filter(l=>available.has(l))
   .map(l=>'<a class="button '+(l===preferred?'preferred':'')+'" href="/purchase-book?session_id='+sid+'&amp;lang='+encodeURIComponent(l)+'">Download full book — '+labels[l]+' (PDF)</a>').join('');
 const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your books | Authors On A Mission</title><style>body{font:18px/1.5 system-ui,Arial,sans-serif;background:#fff3d7;color:#073d2e;padding:25px}main{max-width:580px;margin:auto;padding:26px;background:white;border-radius:16px}.button{display:block;margin:12px 0;padding:15px;border-radius:10px;background:#073d2e;color:white;text-decoration:none;font-weight:700}.preferred{background:#087d40}small{color:#53635b}</style><main><h1>Welcome to Authors On A Mission!</h1><p>Your subscription payment has been verified. Download your complete first book:</p>${links||'<p>Your book is being prepared. Please check back shortly.</p>'}<p><small>Your membership renews automatically unless cancelled. Keep this checkout confirmation link to return while your membership is active.</small></p><a href="/purchase-manage?session_id=${sid}">Manage or cancel your membership</a></main></html>`;
 res.writeHead(200,{...common,'Content-Type':'text/html; charset=utf-8'});res.end(page);return true;
}
