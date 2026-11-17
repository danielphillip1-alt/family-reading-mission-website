import {createHash} from 'node:crypto';
import {giftArchivesWarmed} from './storybook-gifts.mjs';

// Internal audit only. Never logs or serves book content or authentication tokens.
const hash=()=>createHash('sha256');
const head=bytes=>bytes?.subarray(0,5).toString('latin1')==='%PDF-';
const tail=bytes=>bytes?.subarray(-2048).toString('latin1').includes('%%EOF');
const maxChunk=524288;

async function verifyStorybook(pool,row){
 const result=await pool.query('SELECT part,bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',[row.slug,row.language]);
 const expected=Math.ceil(row.size/maxChunk);
 const h=hash();let length=0,first=null,last=null;
 for(let i=0;i<result.rows.length;i++){
  const part=result.rows[i];
  if(part.part!==i||!part.bytes||part.bytes.length!==Math.min(maxChunk,row.size-i*maxChunk))
   return {ok:false,reason:'parts are missing or incorrectly sized'};
  if(i===0)first=part.bytes;
  last=part.bytes;
  h.update(part.bytes);length+=part.bytes.length;
 }
 return {ok:result.rows.length===expected&&length===row.size&&head(first)&&tail(last)&&h.digest('hex')===row.sha256,size:length};
}
async function verifyStoredBook(pool,row){
 const stored=await pool.query('SELECT pdf_content FROM aom_book_files WHERE storage_key=$1 AND sha256=$2',[row.private_object_key,row.sha256]);
 if(stored.rows.length!==1)return {ok:false,reason:'file row absent'};
 const bytes=stored.rows[0].pdf_content;
 return {ok:head(bytes)&&tail(bytes)&&hash().update(bytes).digest('hex')===row.sha256,size:bytes.length};
}
// The full byte audit and live download QA read every PDF several times. On the
// free instance that competed with the first customer download after each
// wake-up, so both run once per deployed commit, after ZIPs are prepared.
export async function releaseAuditPending(pool){
 const commit=process.env.RENDER_GIT_COMMIT||'';
 if(!commit)return true;
 await pool.query('CREATE TABLE IF NOT EXISTS aom_release_audits(commit text PRIMARY KEY, passed_at timestamptz NOT NULL DEFAULT now(), summary jsonb)');
 return !(await pool.query('SELECT 1 FROM aom_release_audits WHERE commit=$1',[commit])).rowCount;
}
export async function recordReleaseAudit(pool,summary){
 const commit=process.env.RENDER_GIT_COMMIT||'';
 if(commit)await pool.query('INSERT INTO aom_release_audits(commit,summary) VALUES($1,$2) ON CONFLICT DO NOTHING',[commit,JSON.stringify(summary)]);
}
export async function auditApprovedBookEditions(pool){
 if(!pool)return {skipped:'database not configured'};
 await giftArchivesWarmed();
 if(!await releaseAuditPending(pool))return {skipped:'already passed for this deployed commit',commit:(process.env.RENDER_GIT_COMMIT||'').slice(0,7)};
 const output=[];
 const staged=await pool.query('SELECT slug,language,size,sha256 FROM aom_storybook_files WHERE approved_at IS NOT NULL ORDER BY slug,language');
 for(const row of staged.rows){
  const result=await verifyStorybook(pool,row);
  output.push({slug:row.slug,language:row.language,source:'storybook',...result});
 }
 const others=await pool.query(`
  SELECT r.slug,e.language,e.private_object_key,e.sha256,'bundle' AS source
   FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug
   WHERE r.status='published' AND e.approved_at IS NOT NULL
  UNION ALL
  SELECT r.slug,e.language,e.private_object_key,e.sha256,'release' AS source
   FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id
   WHERE r.status='published' AND e.approved_at IS NOT NULL`);
 for(const row of others.rows){
  const result=await verifyStoredBook(pool,row);
  output.push({slug:row.slug,language:row.language,source:row.source,...result});
 }
 return {checked:output.length,passed:output.filter(x=>x.ok).length,failed:output.filter(x=>!x.ok),editions:output.map(({slug,language,source,ok,size})=>({slug,language,source,ok,size}))};
}
