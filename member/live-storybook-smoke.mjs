import {createHash,createHmac,randomBytes} from 'node:crypto';

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
   let central=zip.readUInt32LE(zip.length-22+16);
   const seen=new Set();
   for(let i=0;i<number;i++){
    if(zip.readUInt32LE(central)!==0x02014b50)fail('ZIP directory corrupt: '+lang);
    const length=zip.readUInt16LE(central+28),extra=zip.readUInt16LE(central+30),comment=zip.readUInt16LE(central+32);
    const fname=zip.subarray(central+46,central+46+length).toString('utf8');
    const entrySize=zip.readUInt32LE(central+24),offset=zip.readUInt32LE(central+42);
    if(zip.readUInt32LE(offset)!==0x04034b50)fail('ZIP entry corrupt: '+fname);
    const dataStart=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
    const item=rows.find(x=>fname===x.slug+'-'+lang+'.pdf');
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
