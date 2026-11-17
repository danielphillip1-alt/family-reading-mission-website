import {createHash,createHmac,randomBytes} from 'node:crypto';
import {bookZipName} from './zip-library.mjs';
import {releaseAuditPending,recordReleaseAudit} from './audit-approved-editions.mjs';

// Authorized, transaction-free ephemeral audit users. No checkout, mail,
// external recipient, or permanent customer access is created.
const sha=value=>createHash('sha256').update(value).digest('hex');
const codes=['en','de','pt-PT','tr','es','fr'];
const endpoint=()=>`http://127.0.0.1:${Number(process.env.PORT||3000)}`;
const request=(path,options={})=>fetch(endpoint()+path,{redirect:'manual',signal:AbortSignal.timeout(45000),...options});
const fail=message=>{throw Error(message);};
const tokenCode=(token,secret)=>{
 const mac=createHmac('sha256',secret).update('storybook-code:'+token).digest('hex');
 return String(parseInt(mac.slice(0,12),16)%10000).padStart(4,'0');
};
// Stream-check a ZIP without holding it in memory: walk the entries in order,
// hash each stored PDF as it passes, then verify the small central directory.
async function readZip(response,expected){
 const reader=response.body.getReader();let buf=Buffer.alloc(0),total=0;
 const pull=async()=>{const {value,done}=await reader.read();if(done)return false;const b=Buffer.from(value);total+=b.length;buf=buf.length?Buffer.concat([buf,b]):b;return true;};
 const need=async n=>{while(buf.length<n)if(!await pull())fail('ZIP ended early');};
 const take=async n=>{await need(n);const out=Buffer.from(buf.subarray(0,n));buf=buf.subarray(n);return out;};
 const entries=[];
 for(;;){
  await need(4);const sig=buf.readUInt32LE(0);
  if(sig===0x02014b50)break;
  if(sig!==0x04034b50)fail('ZIP structure corrupt');
  const h=await take(30);const name=(await take(h.readUInt16LE(26))).toString('utf8');await take(h.readUInt16LE(28));
  const size=expected.get(name);if(size===undefined)fail('Unexpected ZIP entry: '+name);
  const hash=createHash('sha256');let left=size;
  while(left>0){if(!buf.length&&!await pull())fail('ZIP entry truncated: '+name);const n=Math.min(left,buf.length);hash.update(buf.subarray(0,n));buf=buf.subarray(n);left-=n;}
  const d=await take(16);if(d.readUInt32LE(0)!==0x08074b50||d.readUInt32LE(8)!==size)fail('ZIP descriptor mismatch: '+name);
  entries.push({entry:name,size,sha256:hash.digest('hex')});
 }
 while(await pull());
 const tail=buf;
 if(tail.length<22||tail.readUInt32LE(tail.length-22)!==0x06054b50)fail('ZIP end record missing');
 const count=tail.readUInt16LE(tail.length-12);let at=0;
 for(let i=0;i<count;i++){
  if(tail.readUInt32LE(at)!==0x02014b50)fail('ZIP directory corrupt');
  const n=tail.readUInt16LE(at+28),e=tail.readUInt16LE(at+30),c=tail.readUInt16LE(at+32);
  const name=tail.subarray(at+46,at+46+n).toString('utf8');
  if(!entries[i]||entries[i].entry!==name||entries[i].size!==tail.readUInt32LE(at+24))fail('ZIP directory mismatch: '+name);
  at+=46+n+e+c;
 }
 if(count!==entries.length)fail('ZIP entry count mismatch');
 return {entries,bytes:total,count};
}
const zipNames=(rows,lang)=>new Map(rows.map(r=>[bookZipName(r.slug,lang),r.size]));
async function catalogRows(){
 const r=await request('/api/storybook/catalog');if(r.status!==200)fail('Catalog returned '+r.status);
 return (await r.json()).editions||[];
}
export async function testLiveStorybookRoutes(pool){
 const secret=process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET;
 if(!pool||!secret)return {skipped:'no database or gift-signing secret'};
 if(!await releaseAuditPending(pool))return {skipped:'already passed for this deployed commit'};
 const result=await runLiveStorybookRoutes(pool,secret);
 if(result.passed){
  result.barber=await testBarberGiftDownload(pool).catch(error=>({passed:false,error:error?.message||'unknown'}));
  if(!result.barber.passed)result.passed=false;
 }
 if(result.passed)await recordReleaseAudit(pool,result);
 return result;
}
// Barber gift recipient path, exactly as a customer uses it:
// /barber/open -> choose language -> /barber/redeem?download=1 -> ZIP.
// Also issues two short-lived QA links (2 h, recipient "QA Reader", no email,
// no payment) so the deployed journey can be checked from a real phone browser.
async function testBarberGiftDownload(pool){
 const token=randomBytes(32).toString('hex');
 await pool.query(`INSERT INTO aom_barber_gifts(session_id,purchased_at,buyer_email,buyer_language,gift_hash,sender_name,barber_shop_name,recipient1_name)
  VALUES($1,now(),'qa@example.invalid','en',$2,'Authors On A Mission','QA','QA Reader')`,['qa_'+randomBytes(12).toString('hex'),sha(token)]);
 const opened=await request('/barber/open?gift='+token,{headers:{'Accept-Language':'de-DE'}});
 const html=await opened.text();
 if(opened.status!==200||!html.includes('action="/barber/redeem"')||!html.includes('<option value="de" selected>')||html.includes('name="code"'))
  fail('Barber gift page is not Language then Download');
 const timings={};
 const barberRows=await catalogRows();
 for(const lang of ['de','en','pt-PT']){
  const redeem=await request('/barber/redeem?gift='+token+'&download=1&language='+encodeURIComponent(lang));
  if(redeem.status!==303)fail('Barber redeem failed '+lang);
  const started=performance.now();
  const zip=await request(redeem.headers.get('location'));
  const firstByte=performance.now()-started;
  const z=await readZip(zip,zipNames(barberRows.filter(x=>x.language===lang),lang));
  const total=performance.now()-started;
  if(zip.status!==200||Number(zip.headers.get('content-length'))!==z.bytes)fail('Barber ZIP incomplete '+lang);
  const entries=z.entries;
  timings[lang]={books:entries.length,bytes:z.bytes,firstByteMs:Math.round(firstByte),totalMs:Math.round(total),source:zip.headers.get('x-aom-archive-source'),entries};
 }
 const de=timings.de.entries;
 if(de.length!==barberRows.filter(x=>x.language==='de').length||!de.some(e=>e.entry==='02_Emir_Series/03_Emir_Book_3_Meets_Zachary_de.pdf')||!de.some(e=>e.entry.startsWith('02_Emir_Series/'))||!de.some(e=>e.size===14389311&&e.sha256==='ec7acc227dad7ab3d92893887e96e7d1bcaf80a468779bbbb71e7f017f63a52d'))
  fail('German barber ZIP is missing Emir books or the original Book One');
 const qrGift={};
 for(const lang of ['en','de','fr','es','tr','pt-PT']){
  const started=performance.now();
  const r=await request('/barber/free-bundle.zip?language='+encodeURIComponent(lang));
  qrGift[lang]={status:r.status,books:Number(r.headers.get('x-aom-book-count')),bytes:Number(r.headers.get('content-length')),firstByteMs:Math.round(performance.now()-started)};
  await r.body?.cancel();
  if(r.status!==200||!qrGift[lang].books)fail('Barber QR gift ZIP failed for '+lang);
 }
 const routed=await request('/barber/redeem?gift='+token+'&download=1&language=tr');
 if(routed.status!==303||!routed.headers.get('location').includes('free-bundle.zip?language=tr'))fail('Turkish gift download is not routed');
 const qaSource=sha('qa-gift:'+randomBytes(32).toString('hex')),qaToken=randomBytes(32).toString('hex'),qaBarber=randomBytes(32).toString('hex');
 await pool.query("INSERT INTO aom_storybook_sources(source_hash,kind,expires_at,registered_at) VALUES($1,'qa',now()+interval '2 hours',now())",[qaSource]);
 await pool.query("INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient) VALUES($1,$2,1,'Authors On A Mission','QA Reader')",[sha(qaToken),qaSource]);
 await pool.query(`INSERT INTO aom_barber_gifts(session_id,purchased_at,buyer_email,buyer_language,gift_hash,sender_name,barber_shop_name,recipient1_name)
  VALUES($1,now(),'qa@example.invalid','en',$2,'Authors On A Mission','QA','QA Reader')`,['qa_'+randomBytes(12).toString('hex'),sha(qaBarber)]);
 const base=process.env.APP_URL;
 console.log('AOM two-hour QA gift links (no customer data):',JSON.stringify({storybook:new URL('/storybook/gift?gift='+qaToken,base).href,barber:new URL('/barber/open?gift='+qaBarber,base).href}));
 return {passed:true,qrGift,timings};
}
async function runLiveStorybookRoutes(pool,secret){
 const catalogResponse=await request('/api/storybook/catalog');
 if(catalogResponse.status!==200)fail('Catalog returned '+catalogResponse.status);
 const catalog=await catalogResponse.json();
 const all=catalog.editions||[];
 if(all.some(x=>x.slug==='emir-meets-zachary'&&!['en','es','de','tr','fr','pt-PT'].includes(x.language)))fail('Unapproved Emir Book Three language appeared in public catalog');
 const groups=Object.fromEntries(codes.map(lang=>[lang,all.filter(x=>x.language===lang)]));
 const source=sha('automated-book-audit:'+randomBytes(32).toString('hex'));
 const pairs=[];
 const freeSource=sha('free-gift-audit:'+randomBytes(32).toString('hex'));
 const freeToken=randomBytes(32).toString('hex');
 let checked=0,bytesChecked=0,archivesChecked=0;
 try{
  await pool.query('INSERT INTO aom_storybook_sources(source_hash,kind,expires_at,registered_at) VALUES($1,$2,now()+interval \'15 minutes\',now())',[source,'self-audit']);
  for(let slot=0;slot<codes.length;slot++){
   const token=randomBytes(32).toString('hex');
   await pool.query('INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient) VALUES($1,$2,$3,$4,$5)',
    [sha(token),source,slot+1,'Authors On A Mission QA','Temporary']);
   pairs.push({lang:codes[slot],token});
  }
  for(const {lang,token} of pairs){
   const rows=groups[lang];
   if(!rows.length)fail('No editions found in '+lang);
   const gift=await request('/storybook/gift?gift='+token+'&language='+encodeURIComponent(lang));
   if(gift.status!==200||!(await gift.text()).includes('name="language"'))fail('Gift page failed for '+lang);
   const params=new URLSearchParams({gift:token,language:lang,code:tokenCode(token,secret)});
   const opened=await request('/storybook/open',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:new URL(process.env.APP_URL).origin},body:params});
   if(opened.status!==303)fail('Gift unlock rejected '+lang+': '+opened.status);
   const cookie=opened.headers.get('set-cookie')?.split(';')[0];
   if(!cookie||!cookie.includes('storybook_'))fail('Gift session cookie absent for '+lang);
   const headers={Cookie:cookie};
   const shelf=await request('/storybook/shelf?gift='+token,{headers});
   const html=await shelf.text();
   if(shelf.status!==200||!html.includes('class="books"')||(!['en','es','de','tr','fr','pt-PT'].includes(lang)&&html.includes('slug=emir-meets-zachary')))fail('Incorrect language shelf '+lang);
   const zipped=await request('/storybook/download-all?gift='+token,{headers});
   if(zipped.status!==200||!zipped.headers.get('content-type')?.includes('application/zip'))fail('Download All failed: '+lang+' HTTP '+zipped.status);
   const z=await readZip(zipped,zipNames(rows,lang));
   if(z.count!==rows.length)fail('ZIP contains incorrect number of books: '+lang);
   if(Number(zipped.headers.get('content-length'))!==z.bytes)fail('ZIP advertised length mismatch: '+lang);
   for(const e of z.entries){
    const item=rows.find(x=>e.entry===bookZipName(x.slug,lang));
    if(!item||e.size!==item.size||e.sha256!==item.sha256)fail('ZIP edition integrity failure: '+e.entry);
   }
   archivesChecked++;
   for(const item of rows){
    if(!html.includes('slug='+item.slug))fail('Title missing from shelf: '+lang+' '+item.slug);
    const path='?gift='+token+'&slug='+item.slug;
    const reader=await request('/storybook/read'+path,{headers});
    if(reader.status!==200||!(await reader.text()).includes('<iframe'))fail('Reader failed: '+lang+' '+item.slug);
    const download=await request('/storybook/pdf'+path,{headers});
    if(download.status!==200||!download.headers.get('content-type')?.includes('application/pdf'))
     fail('Download failed: '+lang+' '+item.slug+' HTTP '+download.status);
    const h=createHash('sha256');let len=0,head=null;
    for await(const chunk of download.body){const b=Buffer.from(chunk);if(!head)head=b.subarray(0,5);h.update(b);len+=b.length;}
    if(len!==item.size||h.digest('hex')!==item.sha256||head?.toString('latin1')!=='%PDF-')
     fail('Downloaded PDF mismatches stored edition: '+lang+' '+item.slug);
    const disposition=download.headers.get('content-disposition')||'';
    if(!disposition.includes('attachment'))fail('Missing download disposition: '+lang+' '+item.slug);
    checked++;bytesChecked+=len;
   }
  }
  await pool.query('INSERT INTO aom_storybook_sources(source_hash,kind,expires_at,registered_at) VALUES($1,$2,now()+interval \'15 minutes\',now())',[freeSource,'free']);
  await pool.query('INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient) VALUES($1,$2,1,$3,$4)',
   [sha(freeToken),freeSource,'Authors On A Mission QA','Temporary']);
  const freeGift=await request('/storybook/gift?gift='+freeToken);
  if(freeGift.status!==200)fail('Two-step free gift page unavailable');
  const freeHtml=await freeGift.text();
  if(!freeHtml.includes('name="language"')||!freeHtml.includes('>Download</button>')||freeHtml.includes('name="code"')||freeHtml.includes('Purchase the collection'))
   fail('Free gift page has extra steps');
  const freeZip=await request('/storybook/download-all?gift='+freeToken+'&language=en');
  if(freeZip.status!==200||!freeZip.headers.get('content-type')?.includes('application/zip'))fail('Free gift two-click download failed');
  const freeData=await readZip(freeZip,zipNames(groups.en,'en'));
  if(freeData.count!==groups.en.length)
   fail('Free gift ZIP incomplete');
  const unauthorized=await request('/storybook/pdf?gift='+randomBytes(32).toString('hex')+'&slug=emir-boy-who-never-smiles');
  if(unauthorized.status===200)fail('Unauthenticated download was permitted');
  return {passed:true,languages:codes,editionsChecked:checked,archivesChecked,freeGiftTwoStepPassed:true,bytesChecked,unauthorizedDownloadDenied:true};
 }finally{
  await pool.query('DELETE FROM aom_storybook_claims WHERE source_hash=$1',[source]);
  await pool.query('DELETE FROM aom_storybook_claims WHERE source_hash=$1',[freeSource]);
  await pool.query('DELETE FROM aom_storybook_sources WHERE source_hash=$1',[source]);
  await pool.query('DELETE FROM aom_storybook_sources WHERE source_hash=$1',[freeSource]);
 }
}
