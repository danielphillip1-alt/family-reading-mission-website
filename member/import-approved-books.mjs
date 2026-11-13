import {createHash} from 'node:crypto';
const APPROVED={
 en:{env:'AOM_BOOK_01_EN_SOURCE_URL',sha:'bdcd0873f3cf01d7f1549fd381b99f08baef12acae23fef3ec7b8fad80bb38e2'},
 'pt-PT':{env:'AOM_BOOK_01_PT_SOURCE_URL',sha:'06fe3f58d51d74a914453b986c40fa369fec55ccfd50462dc51dd62074d686e2'},
 de:{env:'AOM_BOOK_01_DE_SOURCE_URL',sha:'c1bcc9a4ca0289e86aa81a64e38f4150568fc6f68098e91abb96b745bbf03d9e'}
};
export async function importApprovedBookOne(pool){
 if(!pool || !Object.values(APPROVED).every(x=>process.env[x.env]))return {skipped:true};
 const staged=[];
 for(const [language,item] of Object.entries(APPROVED)){
  const source=process.env[item.env];
  const url=new URL(source);
  if(url.protocol!=='https:' || url.hostname!=='sdmntprnortheu.oaiusercontent.com')
   throw Error('Unrecognized approved book source for '+language);
  const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('Source fetch failed for '+language+': '+response.status);
  const length=Number(response.headers.get('content-length')||'0');
  if(length>12582912)throw Error('Book too large for '+language);
  const pdf=Buffer.from(await response.arrayBuffer());
  if(pdf.length>12582912||pdf.length<100||pdf.subarray(0,5).toString()!=='%PDF-')
   throw Error('Invalid PDF for '+language);
  const hash=createHash('sha256').update(pdf).digest('hex');
  if(hash!==item.sha)throw Error('Approved book checksum mismatch for '+language);
  staged.push({language,hash,pdf,key:'customer-pdfs/2026-11/book-01-'+language.toLowerCase()+'.pdf'});
 }
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  for(const item of staged)await client.query(
    'INSERT INTO aom_book_files(storage_key,pdf_content,sha256) VALUES($1,$2,$3) ON CONFLICT(storage_key) DO UPDATE SET pdf_content=excluded.pdf_content,sha256=excluded.sha256',
    [item.key,item.pdf,item.hash]);
  const slug='zachary-my-unique-hat-2026-11';
  const id=await client.query(
    "INSERT INTO aom_releases(id,slug,status,published_at) VALUES(gen_random_uuid(),$1,'published',$2) ON CONFLICT(slug) DO UPDATE SET status='published',published_at=excluded.published_at RETURNING id",
    [slug,'2026-11-01T00:00:00Z']);
  const releaseId=id.rows[0].id;
  for(const item of staged)await client.query(
    'INSERT INTO aom_release_editions(release_id,language,private_object_key,sha256,approved_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(release_id,language) DO UPDATE SET private_object_key=excluded.private_object_key,sha256=excluded.sha256,approved_at=excluded.approved_at',
    [releaseId,item.language,item.key,item.hash]);
  await client.query('COMMIT');
  return {imported:true,slug,editions:staged.map(x=>x.language)};
 }catch(error){try{await client.query('ROLLBACK')}catch{} throw error}
 finally{client.release()}
}
