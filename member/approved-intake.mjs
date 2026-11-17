import {createHash} from 'node:crypto';
import {refreshGiftLibrary} from './storybook-gifts.mjs';

// Owner-approved replacement editions (2026-11-17): Zachary Book One in
// English and European Portuguese, each with its original cover included.
// Only these exact files (size + SHA-256) can be ingested, so no secret is
// needed and nothing else can be uploaded. Bytes stay in memory until the
// checksum matches; book content is never written to the public repository.
const approved={
 'zachary-my-unique-hat-2026-11:en':{size:15080055,sha256:'f31050cdc85bda2e3b9c3787319bde64a8a772b6cc3d46b05d6de63bd675d1ad'},
 'zachary-my-unique-hat-2026-11:pt-PT':{size:12394782,sha256:'cf7b75b3b9838389639fec6cb85134244583c7c9e218f307ea9f63779645a68f'}
};
const chunkSize=524288,maxBody=4*1048576;
const pending=new Map();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};

async function stored(pool,slug,lang,want){
 const row=(await pool.query('SELECT size,sha256,approved_at FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang])).rows[0];
 return Boolean(row?.approved_at&&row.sha256===want.sha256&&Number(row.size)===want.size);
}
async function save(pool,slug,lang,pdf,want){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Explicit owner replacement: any earlier private edition of this title and
  // language is removed; published release/bundle records are left untouched.
  await client.query('DELETE FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang]);
  await client.query('INSERT INTO aom_storybook_files(slug,language,size,sha256) VALUES($1,$2,$3,$4)',[slug,lang,want.size,want.sha256]);
  for(let offset=0;offset<pdf.length;offset+=chunkSize)
   await client.query('INSERT INTO aom_storybook_pdf_parts(slug,language,part,bytes) VALUES($1,$2,$3,$4)',[slug,lang,offset/chunkSize,pdf.subarray(offset,offset+chunkSize)]);
  const rows=(await client.query('SELECT bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',[slug,lang])).rows;
  if(digest(Buffer.concat(rows.map(r=>r.bytes)))!==want.sha256)throw Error('Stored edition checksum mismatch');
  await client.query('UPDATE aom_storybook_files SET approved_at=now() WHERE slug=$1 AND language=$2',[slug,lang]);
  await client.query('COMMIT');
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
 finally{client.release()}
}
export async function handleApprovedIntake({req,res,url,pool}){
 if(url.pathname!=='/api/storybook/approved-intake')return false;
 if(!pool){json(res,503,{error:'database unavailable'});return true;}
 const slug=url.searchParams.get('slug'),lang=url.searchParams.get('language');
 const id=slug+':'+lang,want=approved[id];
 if(req.method==='GET'){
  const status={};
  for(const [key,item] of Object.entries(approved)){const [s,l]=key.split(':');status[key]=await stored(pool,s,l,item);}
  json(res,200,status);return true;
 }
 if(req.method!=='POST'||!want){json(res,404,{error:'not an approved edition'});return true;}
 if(await stored(pool,slug,lang,want)){json(res,200,{stored:true,already:true});return true;}
 const offset=Number(url.searchParams.get('offset'));
 const parts=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>maxBody){json(res,413,{error:'chunk too large'});return true;}parts.push(chunk);}
 const body=Buffer.concat(parts);
 let buffer=offset===0?Buffer.alloc(0):pending.get(id);
 if(!buffer||offset!==buffer.length||!body.length||offset+body.length>want.size){pending.delete(id);json(res,409,{error:'unexpected offset',expected:buffer?.length??0});return true;}
 buffer=Buffer.concat([buffer,body]);
 if(buffer.length<want.size){pending.set(id,buffer);json(res,202,{received:buffer.length});return true;}
 pending.delete(id);
 if(digest(buffer)!==want.sha256||buffer.subarray(0,5).toString('latin1')!=='%PDF-'){json(res,422,{error:'checksum mismatch'});return true;}
 await save(pool,slug,lang,buffer,want);
 console.log('Approved edition stored:',JSON.stringify({slug,language:lang,size:want.size,sha256:want.sha256}));
 refreshGiftLibrary(pool);
 json(res,201,{stored:true,size:want.size,sha256:want.sha256});return true;
}
