import { randomUUID } from 'node:crypto';

const RELEVANT_EVENTS = new Set(['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed']);
const MAX_PAYLOAD=1024*1024;
export async function readRawBody(req) {
  const buffers=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>MAX_PAYLOAD) throw Object.assign(new Error('Payload too large'),{status:413});
    buffers.push(chunk);
  }
  return Buffer.concat(buffers);
}
export async function handleStripeWebhook({req,res,stripe,pool,secret}) {
  if(!stripe || !pool || !secret) {res.writeHead(503);res.end('Webhook not configured');return;}
  let event;
  try {
    const body=await readRawBody(req);
    event=stripe.webhooks.constructEvent(body,req.headers['stripe-signature'],secret);
  } catch(e) {
    res.writeHead(e.status||400);res.end('Invalid webhook');return;
  }
  if(!RELEVANT_EVENTS.has(event.type)){res.writeHead(200);res.end('ignored');return;}
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted=await client.query(
      'INSERT INTO aom_stripe_webhook_events (stripe_event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING stripe_event_id',
      [event.id,event.type]);
    if(inserted.rowCount===0) {await client.query('COMMIT');res.writeHead(200);res.end('duplicate');return;}
    const data=event.data.object;
    let customerId=typeof data.customer==='string'?data.customer:data.customer?.id;
    let subscriptionId=null;
    if(event.type.startsWith('customer.subscription.')) subscriptionId=data.id;
    else if(event.type==='checkout.session.completed' && data.mode==='subscription') subscriptionId=data.subscription;
    else if(event.type.startsWith('invoice.')) subscriptionId=typeof data.parent?.subscription_details?.subscription==='string'
      ?data.parent.subscription_details.subscription
      :(typeof data.subscription==='string'?data.subscription:null);
    if(customerId && subscriptionId) {
      // Retrieve authoritative Stripe subscription so out-of-order events cannot roll status backwards.
      const subscription=await stripe.subscriptions.retrieve(subscriptionId);
      const period=subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
      const directLinks=new Set(['plink_1UbGQ6RuZKBP2B3nVEKI0Y7h','plink_1UbOT5RuZKBP2B3nKgZfg1ie']);
      if(event.type==='checkout.session.completed' && directLinks.has(typeof data.payment_link==='string' ? data.payment_link : data.payment_link?.id)){
        const field=data.custom_fields?.find(x=>x.key==='booklanguage');
        const selected=field?.dropdown?.value==='de'?'de':field?.dropdown?.value==='pt'?'pt-PT':'en';
        let email=data.customer_details?.email||data.customer_email;
        if(!email){
          const customer=await stripe.customers.retrieve(customerId);
          email=customer?.email;
        }
        if(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
          await client.query(`INSERT INTO aom_direct_subscriptions
            (stripe_subscription_id,stripe_customer_id,email,language,status,current_period_end)
            VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(stripe_subscription_id) DO UPDATE SET
              email=excluded.email,language=excluded.language,status=excluded.status,
              current_period_end=excluded.current_period_end,updated_at=now()`,
            [subscriptionId,customerId,email.toLowerCase(),selected,subscription.status,period?new Date(period*1000):null]);
        }
      }
      await client.query(`UPDATE aom_direct_subscriptions SET status=$2,current_period_end=$3,updated_at=now()
         WHERE stripe_subscription_id=$1`,[subscriptionId,subscription.status,period?new Date(period*1000):null]);
      const stripeMemberId=subscription.metadata?.member_id||null;

      const matching=await client.query(
        'SELECT id FROM members WHERE stripe_customer_id=$1 OR (id::text=$2 AND stripe_customer_id IS NULL) LIMIT 1',
        [customerId,stripeMemberId||'']);
      const member=matching.rows[0];
      if(member){
        await client.query('UPDATE members SET stripe_customer_id=$1 WHERE id=$2 AND (stripe_customer_id IS NULL OR stripe_customer_id=$1)',[customerId,member.id]);

        await client.query(
          `INSERT INTO aom_subscription_states (stripe_subscription_id,member_id,stripe_customer_id,status,current_period_end,cancel_at_period_end,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`,
          [subscription.id,member.id,customerId,subscription.status,period?new Date(period*1000):null,Boolean(subscription.cancel_at_period_end)]);
        if(['active','trialing'].includes(subscription.status) && period && period*1000>Date.now()){
          await client.query(`INSERT INTO aom_delivery_outbox(id,release_id,member_id,kind,language)
            SELECT gen_random_uuid(),r.id,m.id,'welcome',m.preferred_language
              FROM members m CROSS JOIN LATERAL(
                SELECT r.id FROM aom_releases r JOIN aom_release_editions e
                  ON e.release_id=r.id AND e.language=m.preferred_language
                WHERE r.status='published' AND r.published_at<=now()
                  AND e.approved_at IS NOT NULL ORDER BY r.published_at DESC LIMIT 1
              ) r WHERE m.id=$1
              ON CONFLICT(release_id,member_id,kind) DO NOTHING`,[member.id]);
        }
      }
    }
    await client.query('COMMIT');
    res.writeHead(200);res.end('ok');
  }catch(e){
    try{await client.query('ROLLBACK');}catch{}
    console.error('Stripe webhook processing failed',e?.code||e?.name);
    res.writeHead(500);res.end('retry');
  }finally{client.release();}
}
