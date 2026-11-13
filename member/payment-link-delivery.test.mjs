import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentLinkPlan,capturePaymentLinkEvent} from './payment-link-delivery.mjs';

test('Recognizes only the two approved live membership payment links',()=>{
 assert.equal(paymentLinkPlan('plink_1UbGQ6RuZKBP2B3nVEKI0Y7h'),'monthly');
 assert.equal(paymentLinkPlan('plink_1UbOT5RuZKBP2B3nKgZfg1ie'),'annual');
 assert.equal(paymentLinkPlan('plink_other'),null);
});
test('A paid annual Payment Link checkout creates a subscription record for book emails',async()=>{
 const calls=[];
 const client={async query(sql,args){calls.push({sql,args});return {rowCount:1}}};
 const event={type:'checkout.session.completed',data:{object:{
  mode:'subscription',payment_link:'plink_1UbOT5RuZKBP2B3nKgZfg1ie',
  customer:'cus_123',customer_details:{email:'Buyer@Example.com'},subscription:'sub_123'}}};
 const subscription={status:'active',items:{data:[{current_period_end:1893456000}]}};
 assert.equal(await capturePaymentLinkEvent(client,null,event,subscription),true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].args[0],'sub_123');
 assert.equal(calls[0].args[2],'buyer@example.com');
 assert.equal(calls[0].args[3],'annual');
 assert.equal(calls[0].args[5],'active');
});
test('Unknown payment links do not create membership records',async()=>{
 const client={async query(){throw Error('Should not write any data')}};
 const event={type:'checkout.session.completed',data:{object:{
  mode:'subscription',payment_link:'plink_unknown',customer:'cus_1',
  customer_details:{email:'some@example.com'},subscription:'sub_1'}}};
 assert.equal(await capturePaymentLinkEvent(client,null,event,{status:'active'}),false);
});
