import {randomUUID} from 'node:crypto';
import {sendTransactionalMail,mailConfigured} from './mail.mjs';

// Internal one-time production smoke test; never accepts customer-controlled recipients.
export async function testFirstBookDelivery(pool){
 if(!pool || !mailConfigured()) {
   console.log('Email delivery smoke test: provider missing');
   return {status:'not_configured'};
 }
 await pool.query(`CREATE TABLE IF NOT EXISTS aom_delivery_smoke_tests(
  test_name text PRIMARY KEY,
  state text NOT NULL,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 const token='first-full-book-email-2026-11';
 const claimed=await pool.query(`
 INSERT INTO aom_delivery_smoke_tests(test_name,state,attempts)
 VALUES($1,'processing',1)
 ON CONFLICT(test_name) DO UPDATE
 SET state='processing',attempts=aom_delivery_smoke_tests.attempts+1,updated_at=now()
 WHERE aom_delivery_smoke_tests.state<>'sent'
 AND aom_delivery_smoke_tests.attempts<3
 RETURNING state,attempts`,[token]);
 if(!claimed.rowCount)return {status:'already_sent_or_attempt_limit'};
 try{
  const result=await pool.query(`
   SELECT b.pdf_content FROM aom_releases r
   JOIN aom_release_editions e ON e.release_id=r.id AND e.language='en'
   JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
   WHERE r.slug='zachary-my-unique-hat-2026-11' AND r.status='published'
    AND e.approved_at IS NOT NULL LIMIT 1`);
  if(!result.rowCount)throw Error('Approved Book One English PDF missing');
  const pdf=result.rows[0].pdf_content;
  if(pdf.length<1000 || pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Full PDF invalid');
  const response=await sendTransactionalMail({
    email:'brathatfashionhouse@gmail.com',
    subject:'Authors On A Mission — automatic full Book One email delivery test',
    html:'<p>This is an automatic production delivery test. The complete approved English Book One is attached. No customer purchase or charge occurred.</p>',
    attachments:[{filename:'Zachary_My_Unique_Book_One_EN.pdf',content:pdf.toString('base64')}]
  },token);
  await pool.query(`UPDATE aom_delivery_smoke_tests SET state='sent',provider_message_id=$2,
   updated_at=now() WHERE test_name=$1`,[token,response.id??null]);
  console.log('Email delivery smoke test: SUCCESS, full English PDF attachment bytes',pdf.length);
  return {status:'sent',bytes:pdf.length};
 }catch(error){
  await pool.query(`UPDATE aom_delivery_smoke_tests SET state='failed',updated_at=now()
     WHERE test_name=$1`,[token]);
  console.error('Email delivery smoke test FAILED',error?.message?.slice(0,180)||'unknown');
  return {status:'failed'};
 }
}
