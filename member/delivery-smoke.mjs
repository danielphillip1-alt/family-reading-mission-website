import {randomUUID,randomBytes,createHash} from 'node:crypto';
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

export async function testTranslatedBooksDelivery(pool){
 if(!pool || !mailConfigured())return;
 await testBratHatGift(pool);
 for(const [language,filename] of [
  ['de','Zachary_My_Unique_Book_One_DE.pdf'],
  ['pt-PT','Zachary_My_Unique_Book_One_PT.pdf']
 ]){
  const token='full-book-email-verified-'+language+'-2026-11';
  const claimed=await pool.query(`
    INSERT INTO aom_delivery_smoke_tests(test_name,state,attempts)
    VALUES($1,'processing',1)
    ON CONFLICT(test_name) DO UPDATE
    SET state='processing',attempts=aom_delivery_smoke_tests.attempts+1,updated_at=now()
    WHERE aom_delivery_smoke_tests.state<>'sent'
      AND aom_delivery_smoke_tests.attempts<3 RETURNING state,attempts`,[token]);
  if(!claimed.rowCount)continue;
  try{
   const q=await pool.query(`SELECT b.pdf_content FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id AND e.language=$1
    JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
    WHERE r.status='published' AND r.slug='zachary-my-unique-hat-2026-11'
    AND e.approved_at IS NOT NULL LIMIT 1`,[language]);
   if(!q.rowCount)throw Error('Approved translation missing');
   const pdf=q.rows[0].pdf_content;
   if(pdf.length<1000 || pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid complete PDF');
   const result=await sendTransactionalMail({
      email:'brathatfashionhouse@gmail.com',
      subject:'Authors On A Mission — automatic '+language+' book email delivery test',
      html:'<p>Automated delivery test for the complete '+language+' version of Book One. No customer was charged.</p>',
      attachments:[{filename,content:pdf.toString('base64')}]
   },token);
   await pool.query(`UPDATE aom_delivery_smoke_tests
     SET state='sent',provider_message_id=$2,updated_at=now() WHERE test_name=$1`,[token,result.id??null]);
   console.log('Translation delivery smoke test: SUCCESS',language,'full PDF bytes',pdf.length);
  }catch(error){
   await pool.query(`UPDATE aom_delivery_smoke_tests SET state='failed',updated_at=now() WHERE test_name=$1`,[token]);
   console.error('Translation delivery smoke test FAILED',language,error?.message?.slice(0,120)||'unknown');
  }
 }
}

async function testBratHatGift(pool){
 const testId='internal-brathat-gift-smoke-2026-11-16';
 const email='brathatfashionhouse@gmail.com';
 const name='BratHat Fashion House';
 const token=randomBytes(32).toString('hex');
 const tokenHash=createHash('sha256').update(token).digest('hex');
 const result=await pool.query(`
   INSERT INTO aom_barber_gifts
     (session_id,purchased_at,buyer_email,buyer_language,gift_hash,
      sender_name,recipient1_name,recipient_email)
   VALUES ($1,now(),$2,'en',$3,$4,$4,$2)
   ON CONFLICT(session_id) DO NOTHING
   RETURNING session_id`,[testId,email,tokenHash,name]);
 if(!result.rowCount)return;
 try{
  const link=new URL('/barber/open',process.env.APP_URL);
  link.searchParams.set('gift',token);
  await sendTransactionalMail({
   email,
   subject:'BratHat gift redemption test — Authors On A Mission',
   html:'<p>BratHat Fashion House sent you a digital book gift!</p>'+
      '<p>This is an internal test gift. No purchase or charge occurred.</p>'+
      '<p><a href="'+link.href+'">Open your gift</a></p>'
  },testId);
  await pool.query('UPDATE aom_barber_gifts SET gift1_invited_at=now() WHERE session_id=$1',[testId]);
  console.log('BratHat gift smoke invitation sent');
 }catch(error){
  console.error('BratHat gift smoke invitation failed',error?.name);
 }
}
