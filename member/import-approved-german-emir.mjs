import {readFile} from 'node:fs/promises';
import {createDecipheriv, createHash} from 'node:crypto';

// Approved German Emir Book One is staged on the production branch in encrypted
// slices. Never use a different manuscript, and never publish without exact hash.
const edition={
 slug:'emir-boy-who-never-smiles',
 language:'de',
 name:'emir-book1-de',
 parts:12,
 sha256:'f502d23cea8f3bde85635b773feceae7a57aa582913bfa39fc7ce0f554d02ffd',
 size:16647424
};
const chunkSize=524288;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function importApprovedGermanEmir(pool){
 if(!pool)return {skipped:'database not configured'};
 const existing=(await pool.query('SELECT size,sha256,approved_at IS NOT NULL AS approved FROM aom_storybook_files WHERE slug=$1 AND language=$2',
  [edition.slug,edition.language])).rows[0];
 if(existing?.approved && existing.size===edition.size && existing.sha256===edition.sha256)
  return {alreadyPresent:true,book:edition.slug,language:edition.language};
 if(existing && (existing.size!==edition.size || existing.sha256!==edition.sha256))
  return {skipped:'different edition already registered; no overwrite'};
 let base64='';
 try{
  for(let i=1;i<=edition.parts;i++){
   const part=await readFile(new URL('./secure-staged/'+edition.name+'.part'+String(i).padStart(2,'0')+'.txt',import.meta.url),'utf8');
   if(!/^[A-Za-z0-9+/=\r\n]+$/.test(part.trim()))return {skipped:'staged encoding invalid'};
   base64+=part.trim();
  }
 }catch(err){
  if(err?.code==='ENOENT')return {skipped:'staging incomplete'};
  throw err;
 }
 const packed=Buffer.from(base64,'base64');
 let pdf=null;
 for(const variable of ['AOM_BOOK_BLOB_KEY','AOM_EDITION_DECRYPT_KEY','AOM_STAGED_BOOK_KEY']){
  const hex=process.env[variable];
  if(!/^[0-9a-f]{64}$/i.test(hex||''))continue;
  const key=Buffer.from(hex,'hex');
  const candidates=[];
  // The staged representation may use authenticated AES-GCM with a
  // 12-byte IV and 16-byte tag; support both conventional tag positions.
  if(packed.length===edition.size+28){
   candidates.push({iv:packed.subarray(0,12),data:packed.subarray(12,-16),tag:packed.subarray(-16)});
   candidates.push({iv:packed.subarray(0,12),data:packed.subarray(28),tag:packed.subarray(12,28)});
  }
  for(const item of candidates){
   try{
    const decipher=createDecipheriv('aes-256-gcm',key,item.iv);
    decipher.setAuthTag(item.tag);
    const candidate=Buffer.concat([decipher.update(item.data),decipher.final()]);
    if(candidate.length===edition.size&&candidate.subarray(0,5).toString()==='%PDF-'&&digest(candidate)===edition.sha256){
     pdf=candidate;break;
    }
   }catch{}
  }
  if(pdf)break;
  if(packed.length===edition.size+16){
   try{
    const decipher=createDecipheriv('chacha20',key,packed.subarray(0,16));
    const candidate=Buffer.concat([decipher.update(packed.subarray(16)),decipher.final()]);
    if(candidate.length===edition.size&&candidate.subarray(0,5).toString()==='%PDF-'&&digest(candidate)===edition.sha256){
     pdf=candidate;break;
    }
   }catch{}
  }
 }
 if(!pdf)return {skipped:'staged German edition did not match exact approved PDF checksum'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const existingNow=(await client.query('SELECT size,sha256,approved_at FROM aom_storybook_files WHERE slug=$1 AND language=$2 FOR UPDATE',
   [edition.slug,edition.language])).rows[0];
  if(existingNow && (existingNow.size!==edition.size||existingNow.sha256!==edition.sha256)){
   await client.query('ROLLBACK');return {skipped:'conflicting registered edition'};
  }
  if(!existingNow)await client.query('INSERT INTO aom_storybook_files(slug,language,size,sha256) VALUES($1,$2,$3,$4)',
   [edition.slug,edition.language,edition.size,edition.sha256]);
  for(let offset=0;offset<pdf.length;offset+=chunkSize){
   const bytes=pdf.subarray(offset,offset+chunkSize);
   await client.query('INSERT INTO aom_storybook_pdf_parts(slug,language,part,bytes) VALUES($1,$2,$3,$4) ON CONFLICT(slug,language,part) DO NOTHING',
    [edition.slug,edition.language,offset/chunkSize,bytes]);
  }
  const all=await client.query('SELECT part,octet_length(bytes) AS size FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',
    [edition.slug,edition.language]);
  const expected=Math.ceil(pdf.length/chunkSize);
  if(all.rows.length!==expected||all.rows.some((r,i)=>r.part!==i||r.size!==Math.min(chunkSize,pdf.length-i*chunkSize)))
   throw Error('Approved German Emir storage validation failed');
  await client.query('UPDATE aom_storybook_files SET approved_at=now() WHERE slug=$1 AND language=$2',
   [edition.slug,edition.language]);
  await client.query('COMMIT');
  return {imported:true,book:edition.slug,language:edition.language,size:edition.size,sha256:edition.sha256};
 }catch(err){try{await client.query('ROLLBACK')}catch{}throw err}
 finally{client.release()}
}
