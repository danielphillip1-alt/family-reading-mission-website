import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';
const editions=[
 {slug:'zachary-school-that-believed-in-him',lang:'en',path:'book2-en.enc64',sha:'203032c3881d380e518211542ba6971e830323dfd881d943c2b27b485c266ce4'},
 {slug:'zachary-school-that-believed-in-him',lang:'de',path:'book2-de.enc64',sha:'9daeb243afa71783c039c93d41992b614a5198664767800ec961c1efb8bda5a5'},
 {slug:'zachary-school-that-believed-in-him',lang:'pt-PT',path:'book2-pt.enc64',sha:'246768ac79e235843cb13ca62d7675696637df12eac87704282556bd9796c221'}
];
export async function importStagedEditions(pool){
 if(!pool)return {skipped:'no database'};
 const keyHex=process.env.AOM_EDITION_DECRYPT_KEY;
 if(!/^[0-9a-f]{64}$/i.test(keyHex||''))return {skipped:'no private edition key'};
 const rows=await pool.query("SELECT r.slug,e.language,e.sha256 FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256 WHERE r.slug=$1",['zachary-school-that-believed-in-him']);
 if(editions.every(e=>rows.rows.some(row=>row.slug===e.slug && row.language===e.lang && row.sha256===e.sha)))return {alreadyPresent:true,editions:editions.length};
 const staged=[];
 for(const item of editions){
   const encoded=await readFile(new URL('./secure-editions/'+item.path,import.meta.url),'utf8');
   const all=Buffer.from(encoded.trim(),'base64');
   if(all.length<120||all.length>12582912+16)throw Error('Invalid encrypted PDF size for '+item.lang);
   const iv=all.subarray(0,16);
   const decipher=createDecipheriv('chacha20',Buffer.from(keyHex,'hex'),iv);
   const pdf=Buffer.concat([decipher.update(all.subarray(16)),decipher.final()]);
   const actual=createHash('sha256').update(pdf).digest('hex');
   if(actual!==item.sha||pdf.subarray(0,5).toString()!=='%PDF-'||pdf.length>12582912)throw Error('Edition SHA or PDF integrity failure for '+item.lang);
   staged.push({...item,pdf,key:'customer-pdfs/2026-11/'+item.slug+'/'+item.lang+'.pdf'});
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const created=await client.query("INSERT INTO aom_releases(id,slug,status,published_at) VALUES(gen_random_uuid(),$1,'published',now()) ON CONFLICT(slug) DO UPDATE SET status='published' RETURNING id",['zachary-school-that-believed-in-him']);
  const releaseId=created.rows[0].id;
  for(const e of staged){
    await client.query("INSERT INTO aom_book_files(storage_key,pdf_content,sha256) VALUES($1,$2,$3) ON CONFLICT(storage_key) DO UPDATE SET pdf_content=excluded.pdf_content,sha256=excluded.sha256",[e.key,e.pdf,e.sha]);
    await client.query("INSERT INTO aom_release_editions(release_id,language,private_object_key,sha256,approved_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(release_id,language) DO UPDATE SET private_object_key=excluded.private_object_key,sha256=excluded.sha256,approved_at=excluded.approved_at",[releaseId,e.lang,e.key,e.sha]);
  }
  await client.query('COMMIT');
  return {imported:true,title:'Zachary Book Two',languages:staged.map(x=>x.lang)};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
