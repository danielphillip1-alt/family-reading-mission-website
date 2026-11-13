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
      const stripeMemberId=subscription.metadata?.member_id||null;
      const matching=await client.query(
        'SELECT id FROM members WHERE stripe_customer_id=$1 OR (id::text=$2 AND stripe_customer_id IS NULL) LIMIT 1',
        [customerId,stripeMemberId||'']);
      const member=matching.rows[0];
      if(member){
        await client.query('UPDATE members SET stripe_customer_id=$1 WHERE id=$2 AND (stripe_customer_id IS NULL OR stripe_customer_id=$1)',[customerId,member.id]);
        const period=subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
        await client.query(
          `INSERT INTO aom_subscription_states (stripe_subscription_id,member_id,stripe_customer_id,status,current_period_end,cancel_at_period_end,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`,
          [subscription.id,member.id,customerId,subscription.status,period?new Date(period*1000):null,Boolean(subscription.cancel_at_period_end)]);
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
