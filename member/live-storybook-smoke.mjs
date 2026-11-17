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
 let checked=0,bytesChecked=0;
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
  const unauthorized=await request('/storybook/pdf?gift='+randomBytes(32).toString('hex')+'&slug=emir-boy-who-never-smiles');
  if(unauthorized.status===200)fail('Unauthenticated download was permitted');
  return {passed:true,languages:codes,editionsChecked:checked,bytesChecked,unauthorizedDownloadDenied:true};
 }finally{
  await pool.query('DELETE FROM aom_storybook_claims WHERE source_hash=$1',[source]);
  await pool.query('DELETE FROM aom_storybook_sources WHERE source_hash=$1',[source]);
 }
}
