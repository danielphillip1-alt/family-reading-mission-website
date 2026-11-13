import {sendTransactionalMail} from './mail.mjs';
import { randomUUID } from 'node:crypto';

const PLANS = new Map([
  ['plink_1UbGQ6RuZKBP2B3nVEKI0Y7h', 'monthly'],
  ['plink_1UbOT5RuZKBP2B3nKgZfg1ie', 'annual'],
]);
const LANGUAGES = new Set(['en','de','pt-PT']);

export function paymentLinkPlan(id) {
  return PLANS.get(id) ?? null;
}

export async function capturePaymentLinkEvent(client, stripe, event, subscription) {
  const data = event.data.object;
  if (event.type === 'checkout.session.completed' && data.mode === 'subscription') {
    const plan = paymentLinkPlan(data.payment_link);
    if (!plan || !data.subscription || !data.customer) return false;
    const email = String(data.customer_details?.email ?? data.customer_email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Error('Stripe payment link checkout is missing a valid email');
    const period = subscription?.items?.data?.[0]?.current_period_end ?? subscription?.current_period_end;
    const selected = data.custom_fields?.find(field => field.key === 'booklanguage')?.dropdown?.value;
    const language = selected === 'pt' ? 'pt-PT' : LANGUAGES.has(selected) ? selected : 'en';
    const status = subscription?.status ?? 'incomplete';
    const customer = typeof data.customer === 'string' ? data.customer : data.customer.id;
    await client.query(`INSERT INTO aom_payment_link_memberships
      (stripe_subscription_id,stripe_customer_id,email,plan,language,status,current_period_end,joined_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      stripe_customer_id=excluded.stripe_customer_id,email=excluded.email,
      status=excluded.status,current_period_end=excluded.current_period_end`,
      [data.subscription,customer,email,plan,language,status,period ? new Date(period*1000) : null]);
    return true;
  }
  const id = subscription?.id;
  if (!id) return false;
  const q = await client.query('SELECT stripe_subscription_id FROM aom_payment_link_memberships WHERE stripe_subscription_id=$1',[id]);
  if (!q.rowCount) return false;
  const period = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
  await client.query(`UPDATE aom_payment_link_memberships SET status=$2,current_period_end=$3,
    cancel_at_period_end=$4,updated_at=now() WHERE stripe_subscription_id=$1`,
    [id,subscription.status,period ? new Date(period*1000) : null,Boolean(subscription.cancel_at_period_end)]);
  return true;
}

function cycleStart(now=new Date()){
  return new Date(Date.UTC(now.getUTCFullYear()-(now.getUTCMonth()<10?1:0),10,1));
}

async function emailPdf({to,subject,html,filename,pdf,id}){
 return sendTransactionalMail({email:to,subject,html,
  attachments:[{filename,content:pdf.toString('base64')}]},id);
}

export async function processPaymentLinkDeliveries(pool) {
  if (!pool || !((process.env.AOM_RESEND_API_KEY && process.env.AOM_FROM_EMAIL) || process.env.AOM_GMAIL_APP_PASSWORD)) return {configured:false};
  await pool.query(`UPDATE aom_payment_link_delivery_outbox SET state='retry'
    WHERE state='processing' AND updated_at<now()-interval '15 minutes'`);
  await pool.query(`INSERT INTO aom_payment_link_delivery_outbox(id,stripe_subscription_id,release_id,kind,language)
    SELECT gen_random_uuid(),p.stripe_subscription_id,r.id,
      CASE WHEN r.published_at<=p.joined_at THEN 'welcome' ELSE 'release' END,p.language
    FROM aom_payment_link_memberships p
    JOIN aom_releases r ON r.status='published' AND r.published_at<=now() AND r.published_at >= $1
    JOIN aom_release_editions e ON e.release_id=r.id AND e.language=p.language AND e.approved_at IS NOT NULL
    JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256
    WHERE p.status IN ('active','trialing') AND p.current_period_end>now()
    ON CONFLICT (stripe_subscription_id,release_id) DO NOTHING`,[cycleStart()]);
  const selected=await pool.query(`WITH picked AS (
    SELECT id FROM aom_payment_link_delivery_outbox
    WHERE state IN ('pending','retry') AND next_attempt_at<=now()
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 20
  ) UPDATE aom_payment_link_delivery_outbox o SET state='processing',attempts=attempts+1,updated_at=now()
    FROM picked WHERE o.id=picked.id RETURNING o.*`);
  let sent=0,failed=0;
  for (const task of selected.rows) {
    try {
      const q=await pool.query(`SELECT p.email,p.status,p.current_period_end,r.slug,f.pdf_content
        FROM aom_payment_link_memberships p
        JOIN aom_releases r ON r.id=$2 AND r.status='published'
        JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$3 AND e.approved_at IS NOT NULL
        JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256
        WHERE p.stripe_subscription_id=$1`,[task.stripe_subscription_id,task.release_id,task.language]);
      if (!q.rowCount || !['active','trialing'].includes(q.rows[0].status) ||
          !q.rows[0].current_period_end || q.rows[0].current_period_end <= new Date()) {
        await pool.query("UPDATE aom_payment_link_delivery_outbox SET state='cancelled',updated_at=now() WHERE id=$1",[task.id]);
        continue;
      }
      const item=q.rows[0];
      const subject=task.language==='de'?'Ihr neues Buch von Authors On A Mission':task.language==='pt-PT'?'O seu novo livro da Authors On A Mission':'Your Authors On A Mission book';
      const html='<p>Thank you for joining Authors On A Mission. Your book is attached as a PDF. New approved monthly books will be emailed automatically while your membership remains active.</p>';
      const result=await emailPdf({to:item.email,subject,html,filename:item.slug+'-'+task.language+'.pdf',pdf:item.pdf_content,id:task.id});
      await pool.query("UPDATE aom_payment_link_delivery_outbox SET state='sent',provider_message_id=$2,updated_at=now() WHERE id=$1",[task.id,result.id??null]);
      sent++;
    } catch(error) {
      await pool.query(`UPDATE aom_payment_link_delivery_outbox SET
        state=CASE WHEN attempts>=6 THEN 'failed' ELSE 'retry' END,
        next_attempt_at=now()+LEAST(3600,POWER(2,LEAST(attempts,10))*30)*interval '1 second',
        updated_at=now() WHERE id=$1`,[task.id]);
      failed++;
    }
  }
  return {configured:true,processed:selected.rowCount,sent,failed};
}
