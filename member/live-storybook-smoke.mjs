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
 for(const lang of ['de','en','pt-PT']){
  const redeem=await request('/barber/redeem?gift='+token+'&download=1&language='+encodeURIComponent(lang));
  if(redeem.status!==303)fail('Barber redeem failed '+lang);
  const started=performance.now();
  const zip=await request(redeem.headers.get('location'));
  const firstByte=performance.now()-started;
  const body=Buffer.from(await zip.arrayBuffer());
  const total=performance.now()-started;
  if(zip.status!==200||Number(zip.headers.get('content-length'))!==body.length||body.readUInt32LE(body.length-22)!==0x06054b50)fail('Barber ZIP incomplete '+lang);
  let at=body.readUInt32LE(body.length-6);const entries=[];
  for(let i=0;i<body.readUInt16LE(body.length-12);i++){
   const n=body.readUInt16LE(at+28),size=body.readUInt32LE(at+24),offset=body.readUInt32LE(at+42);
   const start=offset+30+body.readUInt16LE(offset+26)+body.readUInt16LE(offset+28);
   entries.push({entry:body.subarray(at+46,at+46+n).toString(),size,sha256:sha(body.subarray(start,start+size))});
   at+=46+n;
  }
  timings[lang]={books:entries.length,bytes:body.length,firstByteMs:Math.round(firstByte),totalMs:Math.round(total),source:zip.headers.get('x-aom-archive-source'),entries};
 }
 const de=timings.de.entries;
 if(de.length!==5||!de.some(e=>e.entry.startsWith('02_Emir_Series/'))||!de.some(e=>e.size===14389311&&e.sha256==='ec7acc227dad7ab3d92893887e96e7d1bcaf80a468779bbbb71e7f017f63a52d'))
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
 if(all.some(x=>x.slug==='emir-meets-zachary'))fail('Unapproved Emir Book Three appeared in public catalog');
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
   if(shelf.status!==200||!html.includes('class="books"')||html.includes('slug=emir-meets-zachary'))fail('Incorrect language shelf '+lang);
   const zipped=await request('/storybook/download-all?gift='+token,{headers});
   if(zipped.status!==200||!zipped.headers.get('content-type')?.includes('application/zip'))fail('Download All failed: '+lang+' HTTP '+zipped.status);
   const zip=Buffer.from(await zipped.arrayBuffer());
   if(zip.length<22||zip.readUInt32LE(zip.length-22)!==0x06054b50)fail('Download All is not a complete ZIP: '+lang);
   const number=zip.readUInt16LE(zip.length-22+10);
   if(number!==rows.length)fail('ZIP contains incorrect number of books: '+lang);
   if(Number(zipped.headers.get('content-length'))!==zip.length)fail('ZIP advertised length mismatch: '+lang);
   let central=zip.readUInt32LE(zip.length-22+16);
   const seen=new Set();
   for(let i=0;i<number;i++){
    if(zip.readUInt32LE(central)!==0x02014b50)fail('ZIP directory corrupt: '+lang);
    const length=zip.readUInt16LE(central+28),extra=zip.readUInt16LE(central+30),comment=zip.readUInt16LE(central+32);
    const fname=zip.subarray(central+46,central+46+length).toString('utf8');
    const entrySize=zip.readUInt32LE(central+24),offset=zip.readUInt32LE(central+42);
    if(zip.readUInt32LE(offset)!==0x04034b50)fail('ZIP entry corrupt: '+fname);
    const dataStart=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
    const item=rows.find(x=>fname===bookZipName(x.slug,lang));
    if(!item||seen.has(fname)||entrySize!==item.size||sha(zip.subarray(dataStart,dataStart+entrySize))!==item.sha256)
     fail('ZIP edition integrity failure: '+fname);
    seen.add(fname);
    central+=46+length+extra+comment;
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
    const data=Buffer.from(await download.arrayBuffer());
    if(data.length!==item.size||sha(data)!==item.sha256||data.subarray(0,5).toString('latin1')!=='%PDF-')
     fail('Downloaded PDF mismatches stored edition: '+lang+' '+item.slug);
    const disposition=download.headers.get('content-disposition')||'';
    if(!disposition.includes('attachment'))fail('Missing download disposition: '+lang+' '+item.slug);
    checked++;bytesChecked+=data.length;
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
  const freeData=Buffer.from(await freeZip.arrayBuffer());
  if(freeData.length<22||freeData.readUInt32LE(freeData.length-22)!==0x06054b50||freeData.readUInt16LE(freeData.length-12)!==groups.en.length)
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
