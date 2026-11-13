import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleStripeWebhook } from './stripe-webhook.mjs';

function req(payload,signature='valid') {
 const r=Readable.from([Buffer.from(payload)]);
 r.headers={'stripe-signature':signature};
 return r;
}
function res() {
 return {status:0,body:'',writeHead(s){this.status=s;},end(t=''){this.body=t;}};
}
test('Missing credentials return 503 and cannot grant access',async()=>{
 const response=res();
 await handleStripeWebhook({req:req('{}'),res:response,stripe:null,pool:null,secret:null});
 assert.equal(response.status,503);
});
test('Invalid Stripe signature is rejected before database access',async()=>{
 const response=res();
 const stripe={webhooks:{constructEvent(){throw new Error('Bad signature');}}};
 await handleStripeWebhook({req:req('{}','tampered'),res:response,stripe,pool:{connect(){throw new Error('should not access database');}},secret:'whsec_test'});
 assert.equal(response.status,400);
});
test('Unrelated verified events are ignored',async()=>{
 const response=res();
 const stripe={webhooks:{constructEvent(){return {id:'evt_1',type:'account.updated',data:{object:{}}};}}};
 await handleStripeWebhook({req:req('{}'),res:response,stripe,pool:{connect(){throw new Error('should not access db');}},secret:'whsec_test'});
 assert.equal(response.status,200);
 assert.equal(response.body,'ignored');
});
test('Duplicate verified events do not grant access again',async()=>{
 const response=res();
 let sqlCalls=0;let retrievalCalls=0;
 const client={async query(sql){sqlCalls++; if(sql.startsWith('INSERT INTO aom_stripe_webhook_events'))return {rowCount:0};return {rowCount:1};},release(){}};
 const stripe={webhooks:{constructEvent(){return {id:'evt_known',type:'checkout.session.completed',data:{object:{customer:'cus_1',subscription:'sub_1',mode:'subscription'}}};}},
 subscriptions:{async retrieve(){retrievalCalls++;}}};
 await handleStripeWebhook({req:req('{}'),res:response,stripe,pool:{async connect(){return client;}},secret:'whsec_test'});
 assert.equal(response.status,200);assert.equal(response.body,'duplicate');
 assert.equal(retrievalCalls,0);
 assert.equal(sqlCalls,3);
});
