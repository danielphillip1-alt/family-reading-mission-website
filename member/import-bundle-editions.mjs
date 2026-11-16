import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';
const editions=[
  {slug:'zachary-my-unique-hat-2026-11',lang:'de',file:'book1-de',sha:'4ffd5aac2c5efd88d8db02bcba3c3d0be7e4a560de37ed730ee721f997f9a985',parts:0,original:true},
  {slug:'zachary-school-that-believed-in-him',lang:'en',file:'book2-en',sha:'203032c3881d380e518211542ba6971e830323dfd881d943c2b27b485c266ce4',parts:0},
  {slug:'zachary-school-that-believed-in-him',lang:'de',file:'book2-de',sha:'9daeb243afa71783c039c93d41992b614a5198664767800ec961c1efb8bda5a5',parts:0},
  {slug:'zachary-school-that-believed-in-him',lang:'pt-PT',file:'book2-pt',sha:'246768ac79e235843cb13ca62d7675696637df12eac87704282556bd9796c221',parts:0},
  {slug:'zachary-school-that-made-room',lang:'en',file:'book3-en',sha:'58df00cbd62928c9ea5149c7f34c9fbf30bf3b6dfed7c289540f2aca0aed0bbe',parts:7,published:false},
  {slug:'zachary-school-that-made-room',lang:'de',file:'book3-de',sha:'e67ea9a5b8b3927919eb1444b24cd98654070aa8f7e16bf4bd109384426ff6b2',parts:7,published:false},
  {slug:'zachary-school-that-made-room',lang:'pt-PT',file:'book3-pt',sha:'d08d6f9d3c94d907729523ef3b75dd61d12a1a0f413fa9b43f173683490a8d21',parts:7,published:false},
  {slug:'emir-boy-who-never-smiles',lang:'en',file:'emir1-en',sha:'a77e8987e695034c5521a8658311aeff9bb5b4e1c8941a35c90075f08c430cc1',parts:3},
  {slug:'emir-barbershop-boys-and-salon-girls',lang:'en',file:'emir2-en',sha:'b8a7758c401a62c209caed51793abd72203e0a4180c48d072962e0fb6babb9fb',parts:7}
];
async function decrypt(item,key){
 let contents='';
 if(item.parts){for(let i=1;i<=item.parts;i++)contents+=(await readFile(new URL('./secure-editions/'+item.file+'.part'+i,import.meta.url),'utf8')).trim();}
 else contents=(await readFile(new URL('./secure-editions/'+item.file+'.enc64',import.meta.url),'utf8')).trim();
 const packed=Buffer.from(contents,'base64');if(packed.length<100)throw Error('Missing private PDF data for '+item.file);
 const dec=createDecipheriv('chacha20',key,packed.subarray(0,16));
 const pdf=Buffer.concat([dec.update(packed.subarray(16)),dec.final()]);
 if(pdf.length<100||pdf.length>12582912||pdf.subarray(0,5).toString()!=='%PDF-')throw Error('PDF validation failed for '+item.file);
 const sha=createHash('sha256').update(pdf).digest('hex');
 if(sha!==item.sha)throw Error('Checksum mismatch for '+item.file);
 return pdf;
}
export async function importBundleBooks(pool){
 const keyHex=process.env.AOM_BOOK_BLOB_KEY;
 if(!pool||!keyHex||!/^[a-f0-9]{64}$/i.test(keyHex))return {skipped:true,reason:'private edition key unavailable'};
 const key=Buffer.from(keyHex,'hex');
 // Always validate all editions before beginning the import transaction.
 const verified=[];
 for(const edition of editions)verified.push({...edition,pdf:await decrypt(edition,key)});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS aom_bundle_releases(
   slug text PRIMARY KEY,status text NOT NULL CHECK(status IN ('approved','published','withdrawn')),published_at timestamptz)`);
  await client.query(`CREATE TABLE IF NOT EXISTS aom_bundle_release_editions(
   slug text NOT NULL REFERENCES aom_bundle_releases(slug),language text NOT NULL CHECK(language IN ('en','de','pt-PT')),
   private_object_key text NOT NULL,sha256 text NOT NULL,approved_at timestamptz NOT NULL,
   PRIMARY KEY(slug,language))`);
  const inserted=[];
  for(const e of verified){
    const storage='customer-bundle/2026-11/'+e.file+'.pdf';
    const exists=await client.query('SELECT sha256 FROM aom_book_files WHERE storage_key=$1',[storage]);
    if(!exists.rowCount||exists.rows[0].sha256!==e.sha){
      await client.query(`INSERT INTO aom_book_files(storage_key,pdf_content,sha256) VALUES($1,$2,$3)
        ON CONFLICT(storage_key) DO UPDATE SET pdf_content=excluded.pdf_content,sha256=excluded.sha256`,
        [storage,e.pdf,e.sha]);
    }
    if(e.original){
      const release=await client.query('SELECT id FROM aom_releases WHERE slug=$1 AND status=$2',
        [e.slug,'published']);
      if(!release.rowCount)throw Error('The existing Book 1 release is not published');
      await client.query(`INSERT INTO aom_release_editions(release_id,language,private_object_key,sha256,approved_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(release_id,language)
      DO UPDATE SET private_object_key=excluded.private_object_key,sha256=excluded.sha256,approved_at=excluded.approved_at`,
      [release.rows[0].id,e.lang,storage,e.sha]);
    }else{
      const status=e.published===false?'approved':'published';
      await client.query(`INSERT INTO aom_bundle_releases(slug,status,published_at)
       VALUES($1,$2,CASE WHEN $2='published' THEN now() ELSE NULL END)
       ON CONFLICT(slug) DO UPDATE SET status=excluded.status,published_at=COALESCE(aom_bundle_releases.published_at,excluded.published_at)`,
       [e.slug,status]);
      await client.query(`INSERT INTO aom_bundle_release_editions(slug,language,private_object_key,sha256,approved_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(slug,language)
      DO UPDATE SET private_object_key=excluded.private_object_key,sha256=excluded.sha256,approved_at=excluded.approved_at`,
      [e.slug,e.lang,storage,e.sha]);
    }
    inserted.push(e.file);
  }
  await client.query('COMMIT');
  return {imported:true,count:inserted.length,editions:inserted};
 }catch(err){try{await client.query('ROLLBACK')}catch{}throw err}
 finally{client.release()}
}
