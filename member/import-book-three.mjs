import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';

const BOOK='zachary-school-that-made-room';
const EDITIONS=[
 {lang:'de',prefix:'book3-de-new',sha:'e67ea9a5b8b3927919eb1444b24cd98654070aa8f7e16bf4bd109384426ff6b2'},
 {lang:'pt-PT',prefix:'book3-pt-new',sha:'d08d6f9d3c94d907729523ef3b75dd61d12a1a0f413fa9b43f173683490a8d21'}
];

async function decryptPdf(item,key){
 let segments=[];
 for(let i=1;i<=7;i++){
  const raw=await readFile(new URL('./secure-editions/'+item.prefix+'.part'+i,import.meta.url),'utf8');
  if(!/^[A-Za-z0-9+/=\r\n]+$/.test(raw))throw Error('Unrecognized protected book data '+item.prefix+' part '+i);
  segments.push(raw.trim());
 }
 const payload=Buffer.from(segments.join(''),'base64');
 if(payload.length<100||payload.length>12582912+16)throw Error('Book size invalid for '+item.lang);
 const cipher=createDecipheriv('chacha20',key,payload.subarray(0,16));
 const pdf=Buffer.concat([cipher.update(payload.subarray(16)),cipher.final()]);
 if(pdf.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(pdf).digest('hex')!==item.sha)throw Error('Book checksum or PDF signature mismatch for '+item.lang);
 return pdf;
}

export async function importBookThree(pool){
 const keyhex=process.env.AOM_EDITION_DECRYPT_KEY;
 if(!pool||!/^[a-f0-9]{64}$/i.test(keyhex||''))return {skipped:'protected book import key unavailable'};
 const current=await pool.query(`SELECT e.language,e.sha256 FROM aom_bundle_release_editions e JOIN aom_bundle_releases r ON r.slug=e.slug JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE e.slug=$1 AND r.status='published'`,[BOOK]);
 const have=current.rows||[];
 if(have.some(x=>x.language==='en')&&EDITIONS.every(x=>have.some(y=>y.language===x.lang&&y.sha256===x.sha)))return {alreadyPresent:true,count:3};
 // Verify all input PDF signatures/checksums before changing the customer catalog.
 const ready=[];
 for(const item of EDITIONS)ready.push({...item,pdf:await decryptPdf(item,Buffer.from(keyhex,'hex'))});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const en=await client.query(`SELECT e.sha256 FROM aom_bundle_release_editions e JOIN aom_bundle_releases r ON r.slug=e.slug JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE e.slug=$1 AND e.language='en' AND e.approved_at IS NOT NULL`,[BOOK]);
  if(!en.rowCount)throw Error('Approved Book 3 English PDF is not in protected storage');
  for(const x of ready){
   const storage='customer-bundle/2026-11/'+x.prefix+'.pdf';
   await client.query(`INSERT INTO aom_book_files(storage_key,pdf_content,sha256) VALUES($1,$2,$3) ON CONFLICT(storage_key) DO UPDATE SET pdf_content=excluded.pdf_content,sha256=excluded.sha256`,[storage,x.pdf,x.sha]);
   await client.query(`INSERT INTO aom_bundle_release_editions(slug,language,private_object_key,sha256,approved_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(slug,language) DO UPDATE SET private_object_key=excluded.private_object_key,sha256=excluded.sha256,approved_at=excluded.approved_at`,[BOOK,x.lang,storage,x.sha]);
  }
  const all=await client.query(`SELECT COUNT(DISTINCT e.language)::int AS n FROM aom_bundle_release_editions e JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE e.slug=$1 AND e.approved_at IS NOT NULL`,[BOOK]);
  if(all.rows[0]?.n!==3)throw Error('One or more approved Book 3 translations missing after import');
  await client.query(`UPDATE aom_bundle_releases SET status='published',published_at=now() WHERE slug=$1`,[BOOK]);
  await client.query('COMMIT');
  return {imported:true,book:BOOK,editionCount:3};
 }catch(e){await client.query('ROLLBACK');throw e}
 finally{client.release()}
}
