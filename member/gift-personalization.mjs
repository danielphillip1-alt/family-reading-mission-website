import {createHash,createHmac} from 'node:crypto';
import {directGiftAccess,sendCheckoutGiftInvitations} from './barber-gifts.mjs';
import {giftDownloadPage} from './storybook-gifts.mjs';
const SITE='https://theauthorsmission.de';
const PAYMENT_LINK='plink_1UboGGRuZKBP2B3nzmcAPiQL';
const hash=s=>createHash('sha256').update(s).digest('hex');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s??'').trim().replace(/[\x00-\x1f<>]/g,'').slice(0,80);
const giftCode=(session,slot)=>createHmac('sha256',process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET).update(slot===1?'gift:'+session:'gift2:'+session).digest('hex');
const header={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
function send(res,status,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8',...header});res.end(body);}
function page(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+' | Authors On A Mission</title><style>*{box-sizing:border-box}body{background:radial-gradient(circle at 10% 0%,#ffe9ab,transparent 45%),#fff8e7;color:#083b2d;font:17px/1.5 system-ui;margin:0;padding:24px}main{max-width:720px;margin:20px auto;background:#fff;border:3px solid #f5ca53;border-radius:24px;padding:clamp(20px,5vw,40px);box-shadow:0 12px 32px #063f3621}h1{font:900 clamp(30px,5vw,44px)/1.12 Georgia,serif}label{display:block;font-weight:750;margin:16px 0}input{display:block;font:inherit;border:2px solid #b5c7b7;border-radius:10px;padding:12px;width:100%;margin-top:6px}input[type=checkbox]{display:inline-block;width:auto;margin-right:8px}.btn,button{background:#00513c;color:#fff;border:0;border-radius:14px;padding:13px 18px;font:800 16px system-ui;cursor:pointer;display:inline-block;text-decoration:none;margin:8px 0}a{color:#005b46;overflow-wrap:anywhere}.gift{background:#f6f7e8;padding:15px;border-radius:15px;margin:12px 0}small{color:#46645c}</style><main><p><a href="'+SITE+'">Authors On A Mission</a></p><h1>'+esc(title)+'</h1>'+body+'</main></html>';}
async function verified(stripe,id){if(!/^cs_live_[A-Za-z0-9]{16,200}$/.test(id||''))return null;let s;try{s=await stripe.checkout.sessions.retrieve(id)}catch{return null}
return s?.livemode&&s?.mode==='payment'&&s?.status==='complete'&&s?.payment_status==='paid'&&s?.payment_link===PAYMENT_LINK&&s?.currency==='eur'&&s?.amount_total===2499?s:null;}
function shareLink(s,slot){return new URL('/barber/open?gift='+giftCode(s,slot),process.env.APP_URL).href;}
export async function handleGiftPersonalization({req,res,url,stripe,pool}){
  const path=url.pathname;
  if(!['/barber/setup','/barber/open'].includes(path))return false;
  if(!pool||!stripe){send(res,503,page('Gift service unavailable','<p>Please contact support.</p>'));return true;}
  try{
    if(path==='/barber/open'&&req.method==='GET'){
      const token=url.searchParams.get('gift')||'';
      if(!/^[a-f0-9]{64}$/.test(token)){send(res,404,page('Gift link unavailable','<p>This link is not valid.</p>'));return true;}
      const result=await pool.query('SELECT sender_name,barber_shop_name,recipient1_name,recipient2_name,claimed_at,claimed2_at,gift_hash,access_hash,access2_hash FROM aom_barber_gifts WHERE gift_hash=$1 OR gift2_hash=$1',[hash(token)]);
      if(!result.rowCount){send(res,404,page('Gift link unavailable','<p>This gift link was not found.</p>'));return true;}
      const row=result.rows[0],first=row.gift_hash===hash(token);
      if((first?row.claimed_at:row.claimed2_at)&&(first?row.access_hash:row.access2_hash)!==hash(directGiftAccess(token))){send(res,409,page('Gift already claimed','<p>This gift has already been redeemed. Please use your existing private book access link.</p>'));return true;}
      // Language -> Download on the approved gift artwork. The private link is
      // the access token; /barber/redeem records the language and sends the ZIP.
      const sender=clean(row.sender_name)||'Someone special',shop=clean(row.barber_shop_name);
      const html=await giftDownloadPage({pool,req,requested:url.searchParams.get('language'),
        recipient:clean(first?row.recipient1_name:row.recipient2_name)||'Friend',sender:shop?sender+' ('+shop+')':sender,
        action:'/barber/redeem',hidden:{gift:token,download:'1'},codes:['en','de','fr','es','tr','pt-PT']});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...header});res.end(html);return true;
    }
    if(path==='/barber/setup'){
      const id=req.method==='GET'?url.searchParams.get('session_id'):null;
      let data,sessionId=id;
      if(req.method==='POST'){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>8192){send(res,413,page('Form too large','Please try again.'));return true;}chunks.push(chunk)}
        data=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));sessionId=data.get('session_id');
      }else if(req.method!=='GET')return false;
      const session=await verified(stripe,sessionId);
      if(!session){send(res,403,page('Purchase verification needed','<p>Open the private link from your Stripe purchase confirmation. You are not charged again.</p>'));return true;}
      const exists=await pool.query('SELECT sender_name,barber_shop_name,recipient1_name,recipient2_name,gift1_invited_at,gift2_invited_at FROM aom_barber_gifts WHERE session_id=$1',[sessionId]);
      if(req.method==='GET'){
        const prior=exists.rows[0]||{};
        const input=(label,key,value)=>'<label>'+label+'<input name="'+key+'" required maxlength="80" autocomplete="off" value="'+esc(value||'')+'"></label>';
        const body='<p>Payment confirmed. Personalize your two private gifts. The recipient names will appear automatically on the approved gift page.</p>'+
          '<form method="post" action="/barber/setup">'+
          '<input type="hidden" name="session_id" value="'+esc(sessionId)+'">'+
          input('Your name (the gift sender)','sender_name',prior.sender_name)+
          input('Your barbershop name','barber_shop_name',prior.barber_shop_name)+
          input('Gift recipient 1 name','recipient1_name',prior.recipient1_name)+
          input('Gift recipient 2 name','recipient2_name',prior.recipient2_name)+
          '<label><input name="email_permission" type="checkbox" value="yes"> I confirm the named recipients have agreed to receive a gift notification email from Authors On A Mission. If unchecked, I will share the private links myself.</label>'+
          '<button type="submit">Save names and create personalized gifts</button></form>'+
          '<p><small>Each gift is free to the recipient and may be claimed once. No marketing subscription is created.</small></p>';
        send(res,200,page('Personalize your two gifts',body));return true;
      }
      const fields=['sender_name','barber_shop_name','recipient1_name','recipient2_name'];
      const names=Object.fromEntries(fields.map(k=>[k,clean(data.get(k))]));
      if(fields.some(k=>names[k].length<2)){send(res,400,page('Complete all names','<p>Use at least two characters in every name.</p>'));return true;}
      await pool.query('INSERT INTO aom_barber_gifts (session_id,purchased_at,buyer_email,buyer_language,gift_hash,gift2_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(session_id) DO NOTHING',
        [sessionId,new Date(session.created*1000),(session.customer_details?.email||session.customer_email||'').toLowerCase(),'en',hash(giftCode(sessionId,1)),hash(giftCode(sessionId,2))]);
      const q=await pool.query('UPDATE aom_barber_gifts SET sender_name=$2,barber_shop_name=$3,recipient1_name=$4,recipient2_name=$5 WHERE session_id=$1 AND gift1_invited_at IS NULL AND gift2_invited_at IS NULL RETURNING session_id',
        [sessionId,names.sender_name,names.barber_shop_name,names.recipient1_name,names.recipient2_name]);
      if(!q.rowCount){send(res,409,page('Gift invitations already sent','<p>These gift details are locked after sending. Please contact support to request a correction.</p>'));return true;}
      let mailed=[];
      if(data.get('email_permission')==='yes')mailed=await sendCheckoutGiftInvitations({pool,session,personalization:names});
      const links='<section class="gift"><h2>'+esc(names.recipient1_name)+'</h2><a class="btn" href="'+esc(shareLink(sessionId,1))+'">Preview gift 1</a><p><a href="'+esc(shareLink(sessionId,1))+'">'+esc(shareLink(sessionId,1))+'</a></p></section>'+
        '<section class="gift"><h2>'+esc(names.recipient2_name)+'</h2><a class="btn" href="'+esc(shareLink(sessionId,2))+'">Preview gift 2</a><p><a href="'+esc(shareLink(sessionId,2))+'">'+esc(shareLink(sessionId,2))+'</a></p></section>';
      send(res,200,page('Your personalized gift links are ready','<p>Copy each private link and share it with the intended recipient. '+(mailed.length?'Invitation emails requested for '+mailed.length+' recipient(s).':'No gift emails have been sent automatically.')+'</p>'+links+'<p>Keep these links private. Each can only be redeemed once.</p>'));return true;
    }
    return false;
  }catch(e){console.error('Gift personalization error',e?.code||e?.name);send(res,503,page('Gift service temporarily unavailable','<p>Your payment is not lost. Please retry using the private purchase link.</p>'));return true;}
}
