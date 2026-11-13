import { timingSafeEqual, createHash } from 'node:crypto';



const LANGUAGES = new Set(['en','de','pt-PT']);
function readingCycleStart(now = new Date()) {
  const year = now.getUTCFullYear() - (now.getUTCMonth() < 10 ? 1 : 0);
  return new Date(Date.UTC(year, 10, 1));
}

const reply=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const languageOK=(value)=>LANGUAGES.has(value);
const authorized=(req)=>{
  const expected=process.env.AOM_ADMIN_API_TOKEN;
  const provided=req.headers.authorization?.replace(/^Bearer /i,'');
  if(!expected || !provided || provided.length!==expected.length)return false;
  return timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
};
async function parseJSON(req){
  const parts=[];let n=0;
  for await(const chunk of req){n+=chunk.length;if(n>16384)throw Error('Payload too large');parts.push(chunk);}
  return JSON.parse(Buffer.concat(parts).toString('utf-8'));
}
async function entitled(pool,memberId){
  const q=await pool.query(`SELECT 1 FROM aom_subscription_states
     WHERE member_id=$1 AND status IN ('active','trialing')
       AND current_period_end>now() LIMIT 1`,[memberId]);
  return Boolean(q.rowCount);
}
async function sendResend(message,idempotencyKey){
  const key=process.env.AOM_RESEND_API_KEY,from=process.env.AOM_FROM_EMAIL;
  if(!key||!from)throw Error('Email not configured');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify({from,to:[message.email],subject:message.subject,html:message.html,attachments:message.attachments})
  });
  if(!response.ok)throw Error('Mail provider returned '+response.status);
  return await response.json();
}
const COPY={
  en:{subject:'Your new Authors On A Mission book is ready', greeting:'Your new book is ready. Sign in and download it here:'},
  de:{subject:'Ihr neues Buch von Authors On A Mission ist da',greeting:'Ihr neues Buch ist da. Melden Sie sich an und laden Sie es hier herunter:'},
  'pt-PT':{subject:'O seu novo livro da Authors On A Mission está disponível',greeting:'O seu novo livro está disponível. Inicie sessão e descarregue-o aqui:'}
};
function escapeHTML(str){return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

export async function processDueDeliveries(pool) {
  if (!process.env.AOM_RESEND_API_KEY || !process.env.AOM_FROM_EMAIL) return {configured:false};
  await pool.query(`UPDATE aom_releases SET status='published' WHERE status='approved' AND published_at<=now()`);
  await pool.query(`INSERT INTO aom_delivery_outbox
    (id,release_id,member_id,kind,language)
    SELECT gen_random_uuid(),r.id,m.id,'release',m.preferred_language
    FROM aom_releases r CROSS JOIN members m
    JOIN aom_release_editions e ON e.release_id=r.id AND e.language=m.preferred_language
    WHERE r.status='published' AND r.published_at<=now() AND e.approved_at IS NOT NULL
    AND r.published_at > m.created_at
    AND EXISTS(SELECT 1 FROM aom_subscription_states s WHERE s.member_id=m.id
        AND s.status IN ('active','trialing') AND s.current_period_end>now())
    ON CONFLICT (release_id,member_id,kind) DO NOTHING`);
  await pool.query("UPDATE aom_delivery_outbox SET state='retry' WHERE state='processing' AND next_attempt_at < now() - interval '15 minutes'");
  const batch=await pool.query(`WITH picked AS (
     SELECT id FROM aom_delivery_outbox WHERE state IN ('pending','retry')
     AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 30
  ) UPDATE aom_delivery_outbox o SET state='processing',attempts=attempts+1
    FROM picked WHERE o.id=picked.id RETURNING o.*`);
  let sent=0,failed=0;
  for(const task of batch.rows) {
    try{
      if(!await entitled(pool,task.member_id)){await pool.query('UPDATE aom_delivery_outbox SET state=$1 WHERE id=$2',['cancelled',task.id]);continue;}
      const m=await pool.query('SELECT email,preferred_language FROM members WHERE id=$1',[task.member_id]);
      if(!m.rowCount||m.rows[0].preferred_language!==task.language){await pool.query("UPDATE aom_delivery_outbox SET state='cancelled' WHERE id=$1",[task.id]);continue;}
      const l=await pool.query(`SELECT r.slug,b.pdf_content FROM aom_releases r
        JOIN aom_release_editions e ON e.release_id=r.id
        JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
        WHERE r.id=$1 AND r.status='published' AND e.language=$2 AND e.approved_at IS NOT NULL`,[task.release_id,task.language]);
      if(!l.rowCount){throw Error('Edition unavailable');}
      const copy=COPY[task.language];
      const link=new URL('/member', process.env.AOM_PUBLIC_MEMBER_URL || process.env.APP_URL || 'https://authors-on-a-mission-members.onrender.com').href;
      const html='<p>'+escapeHTML(copy.greeting)+'</p><p><a href="'+escapeHTML(link)+'">'+escapeHTML(link)+'</a></p>';
      const edition=l.rows[0];
      const attachment={filename:edition.slug+'-'+task.language+'.pdf',content:edition.pdf_content.toString('base64')};
      const response=await sendResend({email:m.rows[0].email,subject:copy.subject,html,attachments:[attachment]},task.id);
      await pool.query(`UPDATE aom_delivery_outbox SET state='sent',provider_message_id=$1 WHERE id=$2`,[response.id||null,task.id]);sent++;
    }catch(e){
      await pool.query(`UPDATE aom_delivery_outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,
        next_attempt_at=now()+LEAST(3600,POWER(2,LEAST(attempts,10))*60)*interval '1 second'
        WHERE id=$1`,[task.id]);failed++;
    }
  }

  return {configured:true,processed:batch.rowCount,sent,failed};
}

export async function handleBooks(req,res,url,currentMember,pool){
  const path=url.pathname;
  if(!pool){reply(res,503,{error:'Database unavailable'});return true;}
  if(path==='/api/me/language' && req.method==='POST'){
    const member=await currentMember(req);
    if(!member){reply(res,401,{error:'Sign in required'});return true;}
    let body;try{body=await parseJSON(req);}catch{reply(res,400,{error:'Invalid JSON'});return true;}
    if(!languageOK(body.language)){reply(res,400,{error:'Select en, de or pt-PT'});return true;}
    await pool.query('UPDATE members SET preferred_language=$1 WHERE id=$2',[body.language,member.id]);
    reply(res,200,{language:body.language});return true;
  }
  if(path==='/api/books' && req.method==='GET'){
    const member=await currentMember(req);
    if(!member){reply(res,401,{error:'Sign in required'});return true;}
    const active=await entitled(pool,member.id);
    if(!active){reply(res,403,{error:'Active subscription required',books:[]});return true;}
    const q=await pool.query(`SELECT r.slug,r.id,r.published_at,m.preferred_language
        FROM aom_releases r CROSS JOIN members m
        JOIN aom_release_editions e ON e.release_id=r.id AND e.language=m.preferred_language
        WHERE m.id=$1 AND r.status='published' AND r.published_at<=now() AND r.published_at >= $2 AND e.approved_at IS NOT NULL
        ORDER BY r.published_at DESC LIMIT 100`,[member.id,readingCycleStart()]);
    reply(res,200,{language:q.rows[0]?.preferred_language||'en',books:q.rows.map(({slug,id,published_at})=>({id,slug,published_at,download:'/api/books/'+id+'/download'}))});return true;
  }
  const dl=/^\/api\/books\/([0-9a-fA-F-]{36})\/download$/.exec(path);
  if(dl && req.method==='GET'){
    const member=await currentMember(req);
    if(!member){reply(res,401,{error:'Sign in required'});return true;}
    if(!await entitled(pool,member.id)){reply(res,403,{error:'Active subscription required'});return true;}
    const q=await pool.query(`SELECT e.private_object_key
       FROM aom_release_editions e JOIN aom_releases r ON r.id=e.release_id
       JOIN members m ON m.id=$2
       WHERE e.release_id=$1 AND e.language=m.preferred_language
       AND e.approved_at IS NOT NULL AND r.status='published' AND r.published_at<=now() AND r.published_at >= $3`,[dl[1],member.id,readingCycleStart()]);
    if(!q.rowCount){reply(res,404,{error:'Edition not available in your language'});return true;}
    const stored=await pool.query('SELECT pdf_content FROM aom_book_files WHERE storage_key=$1',[q.rows[0].private_object_key]);
    if(!stored.rowCount){reply(res,503,{error:'Approved PDF not yet uploaded'});return true;}
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="authors-on-a-mission.pdf"','Content-Length':stored.rows[0].pdf_content.length,
      'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'});
    res.end(stored.rows[0].pdf_content);return true;
  }
  if(path==='/api/admin/launch-interest' && req.method==='GET'){
    if(!authorized(req)){reply(res,403,{error:'Unauthorized'});return true;}
    const q=await pool.query('SELECT email,language,consented_at,source FROM aom_launch_interest ORDER BY consented_at ASC LIMIT 50000');
    reply(res,200,{count:q.rowCount,contacts:q.rows});return true;
  }
  if(path==='/api/admin/upload-pdf' && req.method==='POST'){
    if(!authorized(req)){reply(res,403,{error:'Unauthorized'});return true;}
    const key=req.headers['x-aom-storage-key'];
    if(typeof key!=='string'||!/^books\/[a-z0-9/_-]+\.pdf$/.test(key)||key.includes('..')){
      reply(res,400,{error:'Invalid private book key'});return true;
    }
    const parts=[];let n=0;
    try{
      for await(const chunk of req){n+=chunk.length;if(n>12582912)throw new Error('PDF exceeds 12 MB');parts.push(chunk);}
      const pdf=Buffer.concat(parts);
      if(pdf.length<100||pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Not a PDF');
      const hash=createHash('sha256').update(pdf).digest('hex');
      await pool.query(`INSERT INTO aom_book_files(storage_key,pdf_content,sha256)
        VALUES($1,$2,$3) ON CONFLICT (storage_key) DO UPDATE SET
        pdf_content=excluded.pdf_content,sha256=excluded.sha256`,[key,pdf,hash]);
      reply(res,201,{storageKey:key,sha256:hash,bytes:pdf.length});
    }catch(e){reply(res,400,{error:e.message});}return true;
  }
  if(path==='/api/admin/releases' && req.method==='POST'){
    if(!authorized(req)){reply(res,403,{error:'Unauthorized'});return true;}
    let body;try{body=await parseJSON(req);}catch{reply(res,400,{error:'Invalid JSON'});return true;}
    if(typeof body.slug!=='string'||!/^[a-z0-9-]{3,80}$/.test(body.slug)||typeof body.publishAt!=='string'||!Number.isFinite(Date.parse(body.publishAt))){reply(res,400,{error:'Invalid release'});return true;}
    const editions=body.editions||{};
    if(![...LANGUAGES].every(l=>typeof editions[l]?.key==='string' && editions[l].key.startsWith('books/') && /^[a-f\d]{64}$/.test(editions[l]?.sha256||''))){
      reply(res,400,{error:'Three approved editions required'});return true;
    }
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(`INSERT INTO aom_releases(id,slug,status,published_at)
        VALUES(gen_random_uuid(),$1,'approved',$2) ON CONFLICT (slug) DO NOTHING RETURNING id`,[body.slug,body.publishAt]);
      if(!q.rowCount)throw new Error('Release slug already exists');
      for (const lang of LANGUAGES) {
        const edition=editions[lang];
        const file=await client.query('SELECT 1 FROM aom_book_files WHERE storage_key=$1 AND sha256=$2',[edition.key,edition.sha256]);
        if(!file.rowCount) throw Error('Approved '+lang+' PDF is not uploaded or its checksum does not match');
      }
      for(const lang of LANGUAGES)await client.query(`INSERT INTO aom_release_editions
        (release_id,language,private_object_key,sha256,approved_at)
        VALUES($1,$2,$3,$4,now())`,[q.rows[0].id,lang,editions[lang].key,editions[lang].sha256]);
      await client.query('COMMIT');reply(res,201,{id:q.rows[0].id});
    }catch(e){await client.query('ROLLBACK');reply(res,409,{error:e.message});}finally{client.release();}
    return true;
  }
  if(path==='/api/admin/deliver' && req.method==='POST'){
    if(!authorized(req)){reply(res,403,{error:'Unauthorized'});return true;}
    if(!process.env.AOM_RESEND_API_KEY||!process.env.AOM_FROM_EMAIL){reply(res,503,{error:'Email service not configured'});return true;}
    const summary = await processDueDeliveries(pool);
    reply(res,200,summary);return true;
  }
  return false;
}
