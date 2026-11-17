import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';

// Restores ONLY the original German Zachary Book One uploaded by the author.
// Original cover and all 41 pages must survive unchanged; no reconstruction,
// substitute illustration, lossy compression, or public file exposure.
const slug='zachary-my-unique-hat-2026-11',lang='de';
const expectedSha='ec7acc227dad7ab3d92893887e96e7d1bcaf80a468779bbbb71e7f017f63a52d';
const expectedSize=14389311,parts=24,chunkSize=524288;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function restoreZacharyGermanOriginal(pool){
 if(!pool)return {skipped:'Database unavailable'};
 const existing=(await pool.query(
  'SELECT size,sha256,approved_at FROM aom_storybook_files WHERE slug=$1 AND language=$2',
  [slug,lang])).rows[0];
 if(existing?.approved_at && existing.sha256===expectedSha && Number(existing.size)===expectedSize){
  const rows=(await pool.query('SELECT part,bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',[slug,lang])).rows;
  const pdf=Buffer.concat(rows.map(r=>r.bytes));
  if(rows.length===Math.ceil(expectedSize/chunkSize)&&pdf.length===expectedSize&&digest(pdf)===expectedSha)
   return {alreadyPresent:true,slug,language:lang,bytes:expectedSize};
 }
 if(existing&&(existing.sha256!==expectedSha||Number(existing.size)!==expectedSize))
  throw Error('Conflicting German Zachary edition; no overwrite permitted');
 const keyHex=process.env.AOM_ZACHARY_DE_RESTORE_KEY;
 if(!/^[0-9a-f]{64}$/i.test(keyHex||''))return {skipped:'Private restoration key unavailable'};
 const fragments=[];
 for(let i=1;i<=parts;i++){
  const path=new URL('./secure-staged/zachary-book1-de.part'+String(i).padStart(2,'0')+'.txt',import.meta.url);
  const encoded=(await readFile(path,'utf8')).trim();
  if(!/^[A-Za-z0-9+/=]+$/.test(encoded))throw Error('Invalid encrypted source chunk '+i);
  fragments.push(Buffer.from(encoded,'base64'));
 }
 const encrypted=Buffer.concat(fragments);
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),encrypted.subarray(0,12));
 decipher.setAuthTag(encrypted.subarray(-16));
 const pdf=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);
 if(pdf.length!==expectedSize||digest(pdf)!==expectedSha||
    pdf.subarray(0,5).toString('latin1')!=='%PDF-'||
    !pdf.subarray(-2048).toString('latin1').includes('%%EOF'))
  throw Error('Approved German Zachary original failed verification');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const current=(await client.query('SELECT size,sha256 FROM aom_storybook_files WHERE slug=$1 AND language=$2 FOR UPDATE',[slug,lang])).rows[0];
  if(current&&(current.sha256!==expectedSha||Number(current.size)!==expectedSize))
   throw Error('Existing protected German edition differs from the approved original');
  await client.query('INSERT INTO aom_storybook_files(slug,language,size,sha256) VALUES($1,$2,$3,$4) ON CONFLICT(slug,language) DO NOTHING',[slug,lang,expectedSize,expectedSha]);
  for(let offset=0;offset<pdf.length;offset+=chunkSize){
   const block=pdf.subarray(offset,offset+chunkSize);
   await client.query('INSERT INTO aom_storybook_pdf_parts(slug,language,part,bytes) VALUES($1,$2,$3,$4) ON CONFLICT(slug,language,part) DO NOTHING',[slug,lang,offset/chunkSize,block]);
  }
  const rows=await client.query('SELECT part,bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',[slug,lang]);
  const stored=Buffer.concat(rows.rows.map(x=>x.bytes));
  if(rows.rows.length!==Math.ceil(pdf.length/chunkSize)||stored.length!==expectedSize||digest(stored)!==expectedSha)
   throw Error('Restored German Zachary PDF integrity check failed');
  await client.query('UPDATE aom_storybook_files SET approved_at=now() WHERE slug=$1 AND language=$2',[slug,lang]);
  await client.query('COMMIT');
  return {restored:true,slug,language:lang,bytes:pdf.length,sha256:expectedSha};
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
 finally{client.release()}
}
