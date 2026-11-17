import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import QRCode from 'qrcode';
import {sendTransactionalMail,mailConfigured} from './mail.mjs';
import {giftArt} from './gift-shelf-art.mjs';
import {storybookAdminPage} from './storybook-admin.mjs';
import {shelfPage,isBundleBook,bundleTitle} from './gift-shelf.mjs';
import {streamBookZip,bookZipByteLength,bookZipOrder,bookZipName} from './zip-library.mjs';
import {privateZipFile,streamCachedZip,cachedZipFile} from './private-zip-cache.mjs';

const SITE='https://theauthorsmission.de';
const languages={en:'English','pt-PT':'Português',de:'Deutsch',tr:'Türkçe',fr:'Français',es:'Español'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>/^[a-f0-9]{64}$/.test(value||'');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const secret=()=>process.env.AOM_BARBER_GIFT_SECRET||process.env.STRIPE_WEBHOOK_SECRET;
const derive=value=>createHmac('sha256',secret()).update(value).digest('hex');
const codeFor=claim=>String(parseInt(derive('storybook-code:'+claim).slice(0,12),16)%10000).padStart(4,'0');
const tokenFor=(source,slot)=>derive('storybook-invite:'+source+':'+slot);
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'strict-origin','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
const options=selected=>Object.entries(languages).map(([key,label])=>'<option value="'+key+'"'+(key===selected?' selected':'')+'>'+label+'</option>').join('');
const urlFor=(path,params={})=>path+'?'+new URLSearchParams(params);
const cookieKey=token=>'storybook_'+token.slice(0,16);
const cookie=(token,value,maxAge)=>cookieKey(token)+'='+value+'; Path=/storybook/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(new URL(process.env.APP_URL).protocol==='https:'?'; Secure':'');
const activeCookie=(req,token)=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieKey(token)+'='))?.split('=')[1];
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const giftLink=token=>urlFor('/storybook/gift',{gift:token});
const bundleSlug='aom-storybook-collection';
const displayName=(name,fallback)=>{const label=String(name||'').trim();return label&&!label.includes('@')?label.slice(0,40):fallback;};
const chunkSize=524288;
// The approved illustrated gift template is kept byte-for-byte; its small
// script and button styles are patched here when served.
const giftScript=`<script>
const art=document.querySelector('.art');
document.querySelector('.gift-tail').style.backgroundImage='url("'+art.src+'")';
const lang=document.querySelector('#language');
const form=document.querySelector('.aom-two-step');
const status=document.querySelector('#downloadStatus');
const button=document.querySelector('#open');
const pinLabels={en:['Your language','Download code','Open My Gift'],de:['Deine Sprache','Downloadcode','Mein Geschenk öffnen'],'pt-PT':['O teu idioma','Código de download','Abrir o meu presente'],tr:['Dilin','İndirme kodu','Hediyemi aç']};
let giftCopy={};try{giftCopy=JSON.parse(form?.dataset.copy||'{}');}catch{}
const relabel=()=>{
 if(!lang)return;
 document.documentElement.lang=lang.value;
 const two=giftCopy[lang.value]||giftCopy.en,pin=pinLabels[lang.value]||pinLabels.en;
 const label=document.querySelector('#languageLabel'),code=document.querySelector('#codeLabel');
 if(form&&two){if(label)label.textContent=two[0];if(button)button.textContent=two[1];if(status)status.textContent='';return;}
 if(label)label.textContent=pin[0];if(code)code.textContent=pin[1];if(button)button.textContent=pin[2];
};
lang?.addEventListener('change',relabel);
form?.addEventListener('submit',()=>{
 const two=giftCopy[lang.value]||giftCopy.en;
 if(status&&two)status.textContent=two[2];
 if(button){button.setAttribute('aria-busy','true');setTimeout(()=>{button.disabled=true;},0);setTimeout(()=>{button.disabled=false;button.removeAttribute('aria-busy');},6000);}
});
addEventListener('pageshow',()=>{if(button){button.disabled=false;button.removeAttribute('aria-busy');}});
</script></body></html>`;
const giftStyle='.download-status{grid-column:1/-1;margin:4px 0 0;font:700 16px/1.4 system-ui,sans-serif;color:#063a2b;min-height:1.4em}.open[disabled]{opacity:.75;cursor:progress}.code-panel select{min-height:48px;font-size:18px}.open{min-height:52px}</style></head>';
let templateCache=null;
const template=async()=>{
 if(templateCache)return templateCache;
 const raw=await readFile(new URL('./storybook-gift.html',import.meta.url),'utf8');
 const at=raw.lastIndexOf('<script>');
 if(at<0||!raw.includes('</style></head>'))throw Error('Gift template layout changed');
 return templateCache=raw.slice(0,at).replace('</style></head>',giftStyle)+giftScript;
};
// Language -> Download page on the approved gift artwork. `action` and
// `hidden` choose which private route receives the language.
export async function giftDownloadPage({pool,req,requested,recipient,sender,action,hidden,codes=Object.keys(languages)}){
 const counts=await languageBookCounts(pool,codes);
 const offered=codes.filter(code=>counts[code]>0);
 const lang=preferredLanguage(requested,req.headers['accept-language'],offered);
 const text=twoStepCopy[lang]||twoStepCopy.en;
 const choices=offered.map(code=>'<option value="'+code+'"'+(code===lang?' selected':'')+'>'+escape(languages[code])+' ('+counts[code]+')</option>').join('');
 const inputs=Object.entries(hidden).map(([k,v])=>'<input type="hidden" name="'+escape(k)+'" value="'+escape(v)+'">').join('');
 const formHtml=offered.length?'<form method="get" action="'+escape(action)+'" class="aom-two-step" data-copy="'+escape(JSON.stringify(twoStepCopy))+'">'+inputs
  +'<label id="languageLabel" for="language">'+escape(text[0])+'</label><select id="language" name="language" required>'+choices+'</select>'
  +'<button class="open" id="open" type="submit">'+escape(text[1])+'</button>'
  +'<p id="downloadStatus" class="download-status" role="status" aria-live="polite"></p></form>'
  :'<p role="status">'+escape(text[3])+'</p>';
 return (await template()).replace('<html lang="en">','<html lang="'+lang+'">')
  .replace('%%RECIPIENT%%',()=>escape(recipient))
  .replace('%%SENDER%%',()=>escape(sender))
  .replace('%%NOTICE%%','')
  .replace('%%FORM%%',()=>formHtml);
}
const copy={
 en:['Your gift has already been opened.','Download all 12 books (PDF)','Finish and visit the website','Download your books before you finish. You have one hour to save them.','Open My Gift','Your language','Download code'],
 de:['Dein Geschenk wurde bereits geöffnet.','Alle 12 Bücher herunterladen (PDF)','Fertig und zur Website','Lade deine Bücher herunter, bevor du fertig bist. Du hast eine Stunde Zeit.','Mein Geschenk öffnen','Deine Sprache','Downloadcode'],
 'pt-PT':['O teu presente já foi aberto.','Descarregar os 12 livros (PDF)','Terminar e visitar o site','Descarrega os teus livros antes de terminares. Tens uma hora para os guardar.','Abrir o meu presente','O teu idioma','Código de download'],
 tr:['Hediyen zaten açıldı.','12 kitabın tümünü indir (PDF)','Bitir ve siteyi ziyaret et','Bitirmeden önce kitaplarını indir. Kaydetmek için bir saatin var.','Hediyemi aç','Dilin','İndirme kodu']
};

// Gift page copy: [language label, button, starting message, nothing available]
const twoStepCopy={
 en:['Language','Download','Your books are downloading. On iPhone, find the ZIP in Files › Downloads.','Your books are being prepared. Please try again later.'],
 de:['Sprache','Herunterladen','Deine Bücher werden heruntergeladen. Auf dem iPhone findest du die ZIP-Datei unter Dateien › Downloads.','Deine Bücher werden vorbereitet. Bitte versuche es später erneut.'],
 'pt-PT':['Idioma','Descarregar','Os teus livros estão a ser descarregados. No iPhone, encontra o ZIP em Ficheiros › Transferências.','Os teus livros estão a ser preparados. Tenta novamente mais tarde.'],
 tr:['Dil','İndir','Kitapların indiriliyor. iPhone’da ZIP dosyasını Dosyalar › İndirilenler bölümünde bulabilirsin.','Kitapların hazırlanıyor. Lütfen daha sonra tekrar dene.'],
 es:['Idioma','Descargar','Tus libros se están descargando. En iPhone, encuentra el ZIP en Archivos › Descargas.','Tus libros se están preparando. Inténtalo más tarde.'],
 fr:['Langue','Télécharger','Tes livres sont en cours de téléchargement. Sur iPhone, retrouve le ZIP dans Fichiers › Téléchargements.','Tes livres sont en préparation. Réessaie plus tard.']
};
function preferredLanguage(requested,acceptLanguage,offered){
 if(offered.includes(requested))return requested;
 for(const part of String(acceptLanguage||'').split(',')){
  const tag=part.split(';')[0].trim().toLowerCase();
  const match=offered.find(code=>code.toLowerCase()===tag)||offered.find(code=>code.split('-')[0]===tag.split('-')[0]);
  if(match)return match;
 }
 return offered.includes('en')?'en':offered[0]||'en';
}

export const storybookSchema=`
 CREATE TABLE IF NOT EXISTS aom_storybook_sources(
  source_hash text PRIMARY KEY, kind text NOT NULL, expires_at timestamptz,
  registered_at timestamptz
 );
 CREATE TABLE IF NOT EXISTS aom_storybook_claims(
  token_hash text PRIMARY KEY, source_hash text NOT NULL REFERENCES aom_storybook_sources,
  slot int NOT NULL, sender text NOT NULL, recipient text NOT NULL,
  destination text, channel text, delivery_at timestamptz,
  attempts int NOT NULL DEFAULT 0, used_at timestamptz, language text,
  session_hash text, session_expires timestamptz, finished_at timestamptz,
  UNIQUE(source_hash,slot)
 );
 CREATE TABLE IF NOT EXISTS aom_storybook_editions(
  language text PRIMARY KEY, slugs text[] NOT NULL CHECK(cardinality(slugs)=12)
 );
 CREATE TABLE IF NOT EXISTS aom_storybook_files(
  slug text NOT NULL, language text NOT NULL, size int NOT NULL,
  sha256 text NOT NULL, approved_at timestamptz, PRIMARY KEY(slug,language)
 );
 CREATE TABLE IF NOT EXISTS aom_storybook_pdf_parts(
  slug text NOT NULL, language text NOT NULL, part int NOT NULL, bytes bytea NOT NULL,
  PRIMARY KEY(slug,language,part),
  FOREIGN KEY(slug,language) REFERENCES aom_storybook_files ON DELETE CASCADE
 );
`;

function send(res,status,body,type='text/html; charset=utf-8'){
 res.writeHead(status,{...headers,'Content-Type':type});res.end(body);
}
function redirect(res,destination,extra={}){
 res.writeHead(303,{...headers,...extra,Location:destination});res.end();
}
function page(title,body,lang='en'){
 return '<!doctype html><html lang="'+lang+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>*{box-sizing:border-box}body{margin:0;background:#063a2b;color:#193527;font:17px/1.5 Georgia,serif}main{max-width:760px;margin:auto;background:#fff2cc;min-height:100vh}img{display:block;width:100%}section{padding:22px clamp(16px,5vw,38px)}h1{color:#8e151b;line-height:1.1;margin-top:0}label{display:block;font-weight:700;margin:10px 0}input:not([type=checkbox]),select{display:block;width:100%;font:inherit;padding:9px;border:1px solid #997036;border-radius:8px}a{color:#075139}.btn,button{display:inline-block;background:#8e151b;color:#fff8dd;border:2px solid #e0ab55;border-radius:30px;padding:10px 15px;font:700 16px Georgia,serif;text-decoration:none;cursor:pointer}fieldset{border:1px solid #b77b2b;margin:12px 0;border-radius:12px}p{overflow-wrap:anywhere}</style><main><img alt="" src="'+giftArt['gift-hero']+'"><section><h1>'+escape(title)+'</h1>'+body+'<p><a href="'+SITE+'">Visit Authors On A Mission</a></p></section></main></html>';
}
async function readBody(req,maximum){
 const parts=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>maximum)return null;parts.push(chunk);}
 return Buffer.concat(parts);
}
async function form(req){
 const body=await readBody(req,8192);
 return body&&new URLSearchParams(body.toString('utf8'));
}
function sourceFields(type,key){
 const input=(label,name,required=false)=>'<label>'+label+'<input name="'+name+'" maxlength="120"'+(required?' required':'')+'></label>';
 return '<form method="post" action="/storybook/send"><input type="hidden" name="kind" value="'+type+'"><input type="hidden" name="key" value="'+escape(key)+'">'+input('Your name (shown on the gift)','sender',true)+
  [1,2].map(n=>'<fieldset><legend>Gift '+n+'</legend>'+input('Recipient name','name'+n)+input('Email address or mobile number with country code','contact'+n)+'</fieldset>').join('')+
  '<label><input type="checkbox" name="permission" value="yes" required> I have permission to send these gifts.</label><button>Send gifts</button></form>';
}
function contacts(f){
 const sender=f.get('sender')?.trim();
 if(!sender||sender.includes('@')||sender.length>40||f.get('permission')!=='yes')return null;
 const recipients=[];
 for(const slot of [1,2]){
  const name=f.get('name'+slot)?.trim(), contact=f.get('contact'+slot)?.trim();
  if(!name&&!contact)continue;
  if(!name||name.includes('@')||name.length>40||!contact||contact.length>120)return null;
  const phone=contact.replace(/[\s()-]/g,'');
  if(/^\+[1-9]\d{7,14}$/.test(phone))recipients.push({slot,name,contact:phone,channel:'sms'});
  else if(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact))recipients.push({slot,name,contact:contact.toLowerCase(),channel:'email'});
  else return null;
 }
 return recipients.length?{sender,recipients}:null;
}

const fileQuery=`
 SELECT e.private_object_key AS storage_key,e.sha256
 FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id
 WHERE r.slug=$1 AND e.language=$2 AND e.approved_at IS NOT NULL AND r.status='published' AND r.published_at<=now()
 UNION ALL
 SELECT e.private_object_key,e.sha256
 FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug
 WHERE r.slug=$1 AND e.language=$2 AND e.approved_at IS NOT NULL AND r.status='published' AND r.published_at<=now()
`;
async function fileFor(pool,slug,lang){
 // Editorial publication lock: technical upload approval is not final manuscript approval.
 if(slug==='emir-meets-zachary')return null;
 const stored=(await pool.query('SELECT size,sha256 FROM aom_storybook_files WHERE slug=$1 AND language=$2 AND approved_at IS NOT NULL',[slug,lang])).rows[0];
 if(stored)return stored;
 const q=await pool.query(`SELECT f.storage_key,f.sha256,octet_length(f.pdf_content) AS size
 FROM (${fileQuery}) edition JOIN aom_book_files f USING(storage_key,sha256)
 WHERE octet_length(f.pdf_content)>5 LIMIT 1`,[slug,lang]);
 return q.rows[0];
}
async function deliverFile(pool,res,slug,lang,inline){
 const file=await fileFor(pool,slug,lang);
 if(!file){send(res,404,'Book unavailable','text/plain');return;}
 res.writeHead(200,{...headers,'Content-Type':'application/pdf','Content-Length':file.size,
  'Content-Disposition':(inline?'inline':'attachment')+'; filename="'+bookZipName(slug,lang).split('/').pop()+'"'});
 for(let offset=1;offset<=file.size&&!res.destroyed;offset+=chunkSize){
  const row=file.storage_key
   ?(await pool.query('SELECT substring(pdf_content FROM $3 FOR 524288) AS bytes FROM aom_book_files WHERE storage_key=$1 AND sha256=$2',[file.storage_key,file.sha256,offset])).rows[0]
   :(await pool.query('SELECT bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 AND part=$3',[slug,lang,(offset-1)/chunkSize])).rows[0];
  if(!row?.bytes?.length){res.destroy();return;}
  if(!res.write(row.bytes)&&!res.destroyed)await once(res,'drain',{signal:AbortSignal.timeout(15000)});
 }
 res.end();
}

// One inventory for every gift, reader and ZIP route: approved PDFs only,
// numbered in reading order, editorially locked titles excluded by fileFor().
const editionCache=new Map();
const editionTtl=60000;
async function languageEditions(pool,lang){
 const cached=editionCache.get(lang);
 if(cached&&Date.now()-cached.at<editionTtl)return cached.books;
 const candidates=[...new Set((await pool.query(
  `SELECT slug FROM aom_storybook_files WHERE language=$1 AND approved_at IS NOT NULL AND slug<>$2
   UNION SELECT r.slug FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id
    WHERE e.language=$1 AND e.approved_at IS NOT NULL AND r.status='published' AND r.published_at<=now()
   UNION SELECT r.slug FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug
    WHERE e.language=$1 AND e.approved_at IS NOT NULL AND r.status='published' AND r.published_at<=now()`,
  [lang,bundleSlug])).rows.map(x=>x.slug))].filter(slug=>isBundleBook(slug)&&slug!=='emir-meets-zachary');
 const books=[];
 for(const slug of candidates){
  const source=await fileFor(pool,slug,lang);
  if(source)books.push({...source,slug,size:Number(source.size)});
 }
 books.sort((a,b)=>bookZipOrder(a.slug)-bookZipOrder(b.slug)||a.slug.localeCompare(b.slug));
 editionCache.set(lang,{at:Date.now(),books});
 return books;
}
async function availableLanguageBooks(pool,lang){
 return (await languageEditions(pool,lang)).map(book=>book.slug);
}
export const approvedLanguageBooks=availableLanguageBooks;
export async function languageBookCounts(pool,codes=Object.keys(languages)){
 const counts={};
 for(const lang of codes)counts[lang]=(await languageEditions(pool,lang)).length;
 return counts;
}

async function* bookChunks(pool,book,lang){
 const batchParts=16;
 if(book.storage_key){
  for(let offset=1;offset<=book.size;offset+=chunkSize*batchParts){
   const row=(await pool.query(
    'SELECT substring(pdf_content FROM $3 FOR $4) AS bytes FROM aom_book_files WHERE storage_key=$1 AND sha256=$2',
    [book.storage_key,book.sha256,offset,chunkSize*batchParts])).rows[0];
   if(!row?.bytes?.length)throw Error('Missing archive PDF bytes');
   for(let pos=0;pos<row.bytes.length;pos+=chunkSize)yield row.bytes.subarray(pos,pos+chunkSize);
  }
 }else{
  const count=Math.ceil(book.size/chunkSize);
  for(let part=0;part<count;part+=batchParts){
   const result=await pool.query(
    'SELECT part,bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 AND part >=$3 AND part<$4 ORDER BY part',
    [book.slug,lang,part,Math.min(count,part+batchParts)]);
   if(result.rows.length!==Math.min(batchParts,count-part))throw Error('Archive edition is incomplete');
   for(let i=0;i<result.rows.length;i++){
    const row=result.rows[i];
    if(row.part!==part+i||!row.bytes?.length)throw Error('Archive PDF chunks are incomplete');
    yield row.bytes;
   }
  }
 }
}
function archivePlan(books,lang){
 const size=bookZipByteLength(books,lang);
 const signature=JSON.stringify([lang,books.map(b=>[b.slug,b.size,b.sha256])]);
 return {size,signature};
}
function buildArchive(pool,books,lang,plan){
 return privateZipFile(plan.signature,plan.size,res=>streamBookZip({res,language:lang,books,readChunks:book=>bookChunks(pool,book,lang)}));
}
// Boot-time ZIP preparation; heavy release audits wait for this first.
let warmDone=Promise.resolve();
export const giftArchivesWarmed=()=>warmDone;
export function warmGiftArchives(pool){
 const started=Date.now();
 const job=(async()=>{
  await purgeQaGifts(pool).catch(error=>console.error('QA gift cleanup failed',error?.code||error?.name));
  const rows=await prepareAllArchives(pool);
  console.log('Private ZIP preparation ms='+(Date.now()-started));
  return rows;
 })();
 warmDone=job.catch(()=>null);
 return job;
}
async function prepareAllArchives(pool){
 const status=[];
 for(const lang of Object.keys(languages)){
  const books=await languageEditions(pool,lang);
  if(!books.length)continue;
  const plan=archivePlan(books,lang);
  await buildArchive(pool,books,lang,plan);
  status.push({language:lang,count:books.length,size:plan.size});
 }
 return status;
}
// Headers go out immediately with the exact Content-Length. A prepared private
// ZIP streams from disk; if the instance just woke and the cache is still being
// built, the same byte-identical ZIP streams directly from the database instead.
export async function sendLanguageZip(pool,res,lang){
 const books=await languageEditions(pool,lang);
 if(!books.length){send(res,404,'No approved books are available in this language yet.','text/plain; charset=utf-8');return;}
 const plan=archivePlan(books,lang);
 const ready=await cachedZipFile(plan.signature,plan.size);
 const filename='Authors_On_A_Mission_'+lang.replace(/[^a-z0-9-]/gi,'_')+'_'+books.length+'_Books.zip';
 res.writeHead(200,{...headers,'Content-Type':'application/zip',
  'Content-Length':plan.size,
  'Content-Disposition':'attachment; filename="'+filename+'"',
  'X-AOM-Book-Count':String(books.length),
  'X-AOM-Archive-Source':ready?'prepared':'direct'});
 if(ready){await streamCachedZip(ready,res);return;}
 buildArchive(pool,books,lang,plan).catch(error=>console.error('Private ZIP cache build failed',error?.message||error?.name));
 await streamBookZip({res,language:lang,books,readChunks:book=>bookChunks(pool,book,lang)});
}
export async function sendApprovedPdf(pool,res,slug,lang,inline=false){
 await deliverFile(pool,res,slug,lang,inline);
}
async function deliverAllBooks(pool,res,slugs,lang){
 await sendLanguageZip(pool,res,lang);
}

async function bundleReady(pool,lang){
 const row=(await pool.query('SELECT slugs FROM aom_storybook_editions WHERE language=$1',[lang])).rows[0];
 if(!row)return null;
 for(const slug of [bundleSlug,...row.slugs])if(!await fileFor(pool,slug,lang))return null;
 return row.slugs;
}
async function uploadPdf(req,res,url,pool){
 const slug=url.searchParams.get('slug'),lang=url.searchParams.get('language');
 if((!isBundleBook(slug)&&slug!==bundleSlug)||!Object.hasOwn(languages,lang)){send(res,400,'Invalid book or language','text/plain');return;}
 const action=url.searchParams.get('action');
 if(action==='start'){
  const f=await form(req), size=Number(f?.get('size')), sha=f?.get('sha256');
  if(!Number.isInteger(size)||size<100||size>300000000||!hex(sha)){send(res,400,'Invalid PDF size or checksum','text/plain');return;}
  const q=await pool.query('INSERT INTO aom_storybook_files(slug,language,size,sha256) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING slug',[slug,lang,size,sha]);
  if(!q.rowCount){
   const row=(await pool.query('SELECT size,sha256 FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang])).rows[0];
   if(row?.size!==size||row?.sha256!==sha){send(res,409,'A different edition already uses this slug and language','text/plain');return;}
  }
  send(res,200,'PDF upload ready','text/plain');return;
 }
 const file=(await pool.query('SELECT size,sha256,approved_at FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang])).rows[0];
 if(!file){send(res,404,'Start the upload first','text/plain');return;}
 if(action==='part'){
  const part=url.searchParams.get('part');
  const bytes=await readBody(req,chunkSize);
  if(!/^\d+$/.test(part||'')||!bytes||bytes.length===0||bytes.length!==Math.min(chunkSize,file.size-Number(part)*chunkSize)){
   send(res,400,'Invalid chunk index or size','text/plain');return;
  }
  await pool.query('INSERT INTO aom_storybook_pdf_parts(slug,language,part,bytes) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[slug,lang,Number(part),bytes]);
  send(res,200,'Saved PDF chunk','text/plain');return;
 }
 if(action==='approve'){
  if(file.approved_at){send(res,200,'PDF approved','text/plain');return;}
  const digest=createHash('sha256');
  for(let offset=0;offset<file.size;offset+=chunkSize){
   const row=(await pool.query('SELECT bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 AND part=$3',[slug,lang,offset/chunkSize])).rows[0];
   if(!row||row.bytes.length!==Math.min(chunkSize,file.size-offset)||(!offset&&Buffer.from(row.bytes.subarray(0,5)).toString()!=='%PDF-')){
    send(res,409,'Incomplete or invalid PDF','text/plain');return;
   }
   digest.update(row.bytes);
  }
  if(digest.digest('hex')!==file.sha256){send(res,409,'PDF checksum mismatch','text/plain');return;}
  await pool.query('UPDATE aom_storybook_files SET approved_at=now() WHERE slug=$1 AND language=$2',[slug,lang]);
  send(res,200,'PDF approved','text/plain');return;
 }
 send(res,400,'Invalid upload action','text/plain');
}
async function verified(stripe,id){
 if(!stripe||!/^cs_live_[a-zA-Z0-9]{16,200}$/.test(id||''))return null;
 let s;
 try{s=await stripe.checkout.sessions.retrieve(id);}catch(e){if(e?.statusCode===404||e?.statusCode===400)return null;throw e;}
 return s?.mode==='payment'&&s.livemode&&s.status==='complete'&&s.payment_status==='paid'&&s.amount_total===2000&&s.currency==='eur'&&s.metadata?.aom_product==='storybook-12'?s:null;
}
async function sendInvite(row,token){
 const link=new URL(giftLink(token),process.env.APP_URL).href;
 const sender=displayName(row.sender,'Someone special');
 const message=sender+' sent you a storybook gift! Open '+link+' , choose your language and tap Download.';
 const key='storybook-'+hash(token);
 if(row.channel==='email'){
  if(!mailConfigured())throw Error('Email delivery unavailable');
  await sendTransactionalMail({email:row.destination,subject:'Your storybook gift',html:'<p>'+escape(sender)+' sent you a storybook gift!</p><p><a href="'+escape(link)+'">Open your gift</a>, choose your language and tap <strong>Download</strong>.</p>'},key);
 }else if(row.channel==='sms'){
  const {AOM_SMS_WEBHOOK_URL:endpoint,AOM_SMS_WEBHOOK_TOKEN:credential}=process.env;
  if(!endpoint||!credential)throw Error('Text delivery unavailable');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({to:row.destination,body:message})});
  if(!response.ok)throw Error('Text provider rejected the invitation');
 }
}
async function register(pool,source,recipientInfo){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query('SELECT registered_at FROM aom_storybook_sources WHERE source_hash=$1 AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE',[source]);
  if(!q.rowCount){await client.query('ROLLBACK');return null;}
  if(!q.rows[0].registered_at){
   for(const r of recipientInfo.recipients){
    const token=tokenFor(source,r.slot);
    await client.query('INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient,channel,destination) VALUES($1,$2,$3,$4,$5,$6,$7)',[hash(token),source,r.slot,recipientInfo.sender,r.name,r.channel,r.contact]);
   }
   await client.query('UPDATE aom_storybook_sources SET registered_at=now() WHERE source_hash=$1',[source]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 const rows=(await pool.query('SELECT * FROM aom_storybook_claims WHERE source_hash=$1 AND slot>0 ORDER BY slot',[source])).rows;
 return rows;
}
async function purchase(pool,session,requireDelivery=false){
 const source=hash('paid:'+session.id), token=tokenFor(source,0);
 await pool.query("INSERT INTO aom_storybook_sources(source_hash,kind) VALUES($1,'paid') ON CONFLICT DO NOTHING",[source]);
 await pool.query("INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient,channel,destination) VALUES($1,$2,0,'Authors On A Mission','Friend','email',$3) ON CONFLICT DO NOTHING",[hash(token),source,session.customer_details?.email||session.customer_email||null]);
 const row=(await pool.query('SELECT * FROM aom_storybook_claims WHERE token_hash=$1',[hash(token)])).rows[0];
 if(row?.destination&&!row.delivery_at){
  try{await sendInvite(row,token);await pool.query('UPDATE aom_storybook_claims SET delivery_at=now() WHERE token_hash=$1',[hash(token)]);}
  catch(error){if(requireDelivery)throw error;console.error('Storybook receipt delivery failed',error.name);}
 }
 return token;
}
export async function purgeQaGifts(pool){
 if(!pool)return;
 await pool.query("DELETE FROM aom_storybook_claims WHERE source_hash IN (SELECT source_hash FROM aom_storybook_sources WHERE kind='qa' AND expires_at<now())");
 await pool.query("DELETE FROM aom_storybook_sources WHERE kind='qa' AND expires_at<now()");
 await pool.query("DELETE FROM aom_barber_gifts WHERE session_id LIKE 'qa\\_%' AND purchased_at<now()-interval '2 hours'");
}
export async function deliverStorybookPurchase(pool,session){
 if(!pool||!secret()||!session?.livemode||session.mode!=='payment'||session.status!=='complete'||session.payment_status!=='paid'||session.amount_total!==2000||session.currency!=='eur'||session.metadata?.aom_product!=='storybook-12')return;
 await purchase(pool,session,true);
}
function inviteCard(token,name){
 return '<fieldset><legend>'+escape(name)+'</legend><a class="btn" href="'+escape(giftLink(token))+'">Open gift page</a></fieldset>';
}

export async function handleStorybook({req,res,url,pool,stripe}){
 const path=url.pathname,method=req.method;
 if(!path.startsWith('/storybook/')&&!path.startsWith('/api/admin/storybook/')&&path!=='/barber/checkout'&&path!=='/api/storybook/catalog')return false;
 if(path==='/api/admin/storybook/upload'&&method==='GET'){
  send(res,200,storybookAdminPage(),'text/html; charset=utf-8');return true;
 }
 if(path==='/storybook/cover'&&method==='GET'){
  const slug=url.searchParams.get('slug');
  if(slug==='zachary-my-unique-hat-2026-11'&&url.searchParams.get('language')==='de'){
   const encoded=await readFile(new URL('./approved-covers/zachary-book1-de.jpg.b64',import.meta.url),'utf8');
   const bytes=Buffer.from(encoded.trim(),'base64');
   if(bytes.length<100000||bytes[0]!==0xff||bytes[1]!==0xd8){send(res,503,'Cover temporarily unavailable','text/plain');return true;}
   res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,
    'X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=3600'});
   res.end(bytes);return true;
  }
  if(!isBundleBook(slug)||slug==='emir-meets-zachary'||!giftArt[slug]){
   send(res,404,'Cover unavailable','text/plain');return true;
  }
  const stored=giftArt[slug];
  if(!stored.startsWith('data:image/webp;base64,')){send(res,404,'Cover unavailable','text/plain');return true;}
  const bytes=Buffer.from(stored.slice('data:image/webp;base64,'.length),'base64');
  res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=3600'});
  res.end(bytes);return true;
 }
 if(path==='/api/storybook/catalog'&&method==='GET'){
  const origin=req.headers.origin;
  if(['https://www.theauthorsmission.de','https://theauthorsmission.de','https://family-reading-mission.onrender.com'].includes(origin))
   res.setHeader('Access-Control-Allow-Origin',origin);
  if(!pool){send(res,503,JSON.stringify({error:'catalog temporarily unavailable'}),'application/json');return true;}
  try{
   const data=await pool.query(`
    SELECT f.slug,f.language,f.size,f.sha256,'private-storybook' AS source
      FROM aom_storybook_files f
      JOIN (SELECT slug,language,COUNT(*) AS count,SUM(octet_length(bytes)) AS bytes
            FROM aom_storybook_pdf_parts GROUP BY slug,language) p
        ON p.slug=f.slug AND p.language=f.language
     WHERE f.approved_at IS NOT NULL AND f.slug<>'emir-meets-zachary' AND p.bytes=f.size AND p.count=ceil(f.size::numeric/524288)
    UNION ALL
    SELECT r.slug,e.language,octet_length(b.pdf_content) AS size,e.sha256,'bundle' AS source
      FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug
      JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
     WHERE r.status='published' AND r.published_at<=now() AND e.approved_at IS NOT NULL
    UNION ALL
    SELECT r.slug,e.language,octet_length(b.pdf_content) AS size,e.sha256,'release' AS source
      FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id
      JOIN aom_book_files b ON b.storage_key=e.private_object_key AND b.sha256=e.sha256
     WHERE r.status='published' AND r.published_at<=now() AND e.approved_at IS NOT NULL
    ORDER BY slug,language,source`);
   const chosen=new Map();
   for(const edition of data.rows){
    const id=edition.slug+':'+edition.language;
    if(!chosen.has(id)||edition.source==='private-storybook')chosen.set(id,edition);
   }
   const editions=[...chosen.values()];
   send(res,200,JSON.stringify({editions,count:editions.length}),'application/json');
  }catch(error){console.error('Storybook catalog query failed',error.code||error.name);send(res,503,JSON.stringify({error:'catalog temporarily unavailable'}),'application/json');}
  return true;
 }
 if(!pool||!secret()){send(res,503,page('Storybook gifts are unavailable','<p>Please try again later.</p>'));return true;}
 try{
  if(path==='/storybook/issue'&&method==='GET'){
   const body='<p>Create a free QR for up to two recipients.</p><form id="issue"><label>Organizer key<input id="key" type="password" required autocomplete="off"></label><button>Create gift QR</button></form><p role="status" id="result"></p><script>document.querySelector("#issue").addEventListener("submit",async event=>{event.preventDefault();const key=document.querySelector("#key"),result=document.querySelector("#result");try{const response=await fetch("/api/admin/storybook/issue",{method:"POST",headers:{Authorization:"Bearer "+key.value}});key.value="";if(!response.ok)throw Error();const gift=await response.json();const picture=new Image();picture.src=gift.qr;picture.alt="Free gift QR code";picture.style.width="230px";const link=document.createElement("a");link.href=gift.url;link.textContent="Open or copy the free gifting link";result.replaceChildren(picture,link);}catch{result.textContent="The QR could not be created. Check your organizer key.";}});</script>';
   send(res,200,page('Create a free gift QR',body));return true;
  }
  if(path.startsWith('/api/admin/storybook/')&&method==='POST'){
   const token=process.env.AOM_ADMIN_API_TOKEN;
   if(!token||!equal(req.headers.authorization||'','Bearer '+token)){send(res,403,'Forbidden','text/plain');return true;}
   if(path==='/api/admin/storybook/status'){
    const result=await pool.query('SELECT slug,language,size,approved_at IS NOT NULL AS approved FROM aom_storybook_files ORDER BY slug,language');
    send(res,200,JSON.stringify({files:result.rows}),'application/json');return true;
   }
   if(path==='/api/admin/storybook/pdf'){await uploadPdf(req,res,url,pool);return true;}
   // Short-lived QA gifts exercise the exact customer routes from outside.
   // They expire after two hours, are deleted on the next QA request or boot,
   // never send email, and are never attached to a customer or payment.
   if(path==='/api/admin/storybook/qa-gift'){
    await purgeQaGifts(pool);
    const qaSource=hash('qa-gift:'+randomBytes(32).toString('hex')),qaToken=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO aom_storybook_sources(source_hash,kind,expires_at,registered_at) VALUES($1,'qa',now()+interval '2 hours',now())",[qaSource]);
    await pool.query("INSERT INTO aom_storybook_claims(token_hash,source_hash,slot,sender,recipient) VALUES($1,$2,1,'Authors On A Mission','QA Reader')",[hash(qaToken),qaSource]);
    const barberToken=randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO aom_barber_gifts(session_id,purchased_at,buyer_email,buyer_language,gift_hash,sender_name,barber_shop_name,recipient1_name)
     VALUES($1,now(),'qa@example.invalid','en',$2,'Authors On A Mission','QA','QA Reader')`,['qa_'+randomBytes(12).toString('hex'),hash(barberToken)]);
    send(res,201,JSON.stringify({storybookGiftUrl:new URL(giftLink(qaToken),process.env.APP_URL).href,
     barberGiftUrl:new URL('/barber/open?gift='+barberToken,process.env.APP_URL).href,expiresInMinutes:120}),'application/json');return true;
   }
   if(path==='/api/admin/storybook/diagnostics'){
    const files=(await pool.query(`SELECT slug,language,size,sha256,approved_at IS NOT NULL AS approved,'storybook' AS source FROM aom_storybook_files
     UNION ALL SELECT r.slug,e.language,octet_length(f.pdf_content),e.sha256,e.approved_at IS NOT NULL,'release:'||r.status FROM aom_releases r JOIN aom_release_editions e ON e.release_id=r.id LEFT JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256
     UNION ALL SELECT r.slug,e.language,octet_length(f.pdf_content),e.sha256,e.approved_at IS NOT NULL,'bundle:'||r.status FROM aom_bundle_releases r JOIN aom_bundle_release_editions e ON e.slug=r.slug LEFT JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256
     ORDER BY 1,2,6`)).rows;
    const gifts=(await pool.query(`SELECT s.kind,count(c.*)::int AS claims,count(c.used_at)::int AS opened FROM aom_storybook_sources s LEFT JOIN aom_storybook_claims c USING(source_hash) GROUP BY s.kind`)).rows;
    const barber=(await pool.query(`SELECT count(*)::int AS purchases,count(claimed_at)::int+count(claimed2_at)::int AS claimed,
     count(*) FILTER (WHERE session_id NOT LIKE 'qa\\_%')::int AS real_purchases FROM aom_barber_gifts`)).rows[0];
    const download={};
    for(const lang of Object.keys(languages))download[lang]=(await languageEditions(pool,lang)).map(b=>({slug:b.slug,entry:bookZipName(b.slug,lang),size:b.size,sha256:b.sha256,source:b.storage_key?'release-or-bundle':'storybook'}));
    send(res,200,JSON.stringify({files,gifts,barber,download,commit:process.env.RENDER_GIT_COMMIT||null}),'application/json');return true;
   }
   const data=await form(req);
   if(path==='/api/admin/storybook/issue'){
    const key=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO aom_storybook_sources(source_hash,kind,expires_at) VALUES($1,'free',now()+interval '30 days')",[hash('free:'+key)]);
    const giftUrl=new URL(urlFor('/storybook/send',{free:key}),process.env.APP_URL).href;
    send(res,201,JSON.stringify({url:giftUrl,qr:await QRCode.toDataURL(giftUrl,{width:320}),recipientLimit:2,expiresInDays:30}),'application/json');return true;
   }
   if(path==='/api/admin/storybook/edition'){
    const lang=data?.get('language'),slugs=data?.getAll('slug')||[];
    if(!Object.hasOwn(languages,lang)||slugs.length!==12||new Set(slugs).size!==12||!slugs.every(isBundleBook)){
     send(res,400,'Choose a language and 12 unique book slugs in reading order.','text/plain');return true;
    }
    for(const slug of [bundleSlug,...slugs])if(!await fileFor(pool,slug,lang)){send(res,409,'Missing approved PDF: '+slug,'text/plain');return true;}
    const other=(await pool.query('SELECT slugs FROM aom_storybook_editions WHERE language<>$1 LIMIT 1',[lang])).rows[0];
    if(other&&JSON.stringify(other.slugs)!==JSON.stringify(slugs)){send(res,409,'All languages must use the same 12 books in the same order.','text/plain');return true;}
    await pool.query('INSERT INTO aom_storybook_editions(language,slugs) VALUES($1,$2) ON CONFLICT(language) DO UPDATE SET slugs=EXCLUDED.slugs',[lang,slugs]);
    send(res,200,'Edition registered','text/plain');return true;
   }
  }
  if(path==='/barber/checkout'&&(method==='GET'||method==='POST')){
   const price=process.env.AOM_STORYBOOK_PRICE_ID;
   let ready=Boolean(stripe&&price);
   if(ready)for(const lang of Object.keys(languages))if(!await bundleReady(pool,lang)){ready=false;break;}
   const details='<p>12 digital books for €20, plus two free gifts with the full collection.</p>';
   if(!ready){send(res,503,page('Your storybook bundle',details+'<p>Checkout opens when the complete collection is ready.</p>'));return true;}
   if(method==='GET'){send(res,200,page('Your storybook bundle',details+'<form method="post"><button>Continue to secure checkout</button></form>'));return true;}
   const configured=await stripe.prices.retrieve(price);
   if(!configured.active||configured.type!=='one_time'||configured.unit_amount!==2000||configured.currency!=='eur'){
    send(res,503,page('Checkout unavailable',details));return true;
   }
   const checkout=await stripe.checkout.sessions.create({mode:'payment',line_items:[{price,quantity:1}],payment_method_types:['card'],automatic_tax:{enabled:true},billing_address_collection:'required',
    metadata:{aom_product:'storybook-12'},success_url:new URL('/storybook/send?purchase={CHECKOUT_SESSION_ID}',process.env.APP_URL).href,
    cancel_url:new URL('/barber/checkout',process.env.APP_URL).href});
   redirect(res,checkout.url);return true;
  }
  if(path==='/storybook/send'&&(method==='GET'||method==='POST')){
   const data=method==='POST'?await form(req):null;
   const kind=method==='GET'?(url.searchParams.has('purchase')?'paid':'free'):data?.get('kind');
   const key=method==='GET'?url.searchParams.get(kind==='paid'?'purchase':'free'):data?.get('key');
   const session=kind==='paid'?await verified(stripe,key):null;
   if((kind==='free'&&!hex(key))||(kind==='paid'&&!session)||!['free','paid'].includes(kind)){
    send(res,403,page('Open your private gifting link','<p>Scan a free gift QR or use the link from your purchase.</p>'));return true;
   }
   const source=hash(kind+':'+key);
   if(session)await purchase(pool,session);
   if(!(await pool.query('SELECT 1 FROM aom_storybook_sources WHERE source_hash=$1 AND (expires_at IS NULL OR expires_at>now())',[source])).rowCount){
    send(res,404,page('This gifting link is unavailable','<p>Ask the gift organizer for a new link.</p>'));return true;
   }
   if(method==='GET'){
    send(res,200,page('Send a storybook gift',(session?inviteCard(tokenFor(source,0),'Your books'):'')+sourceFields(kind,key)));return true;
   }
   const info=data&&contacts(data);
   if(!info){send(res,400,page('Check the gift details','<p>Enter names of up to 40 characters in the name fields. Put email addresses or phone numbers in the contact fields.</p>'+sourceFields(kind,key)));return true;}
   const rows=await register(pool,source,info);
   if(!rows){send(res,409,page('This gifting link has expired',''));return true;}
   let result='';
   for(const row of rows){
    const token=tokenFor(source,row.slot);let sent=Boolean(row.delivery_at);
    if(!sent)try{await sendInvite(row,token);await pool.query('UPDATE aom_storybook_claims SET delivery_at=now() WHERE token_hash=$1',[hash(token)]);sent=true;}
    catch(error){console.error('Storybook invitation delivery failed',error.name);}
    result+=inviteCard(token,displayName(row.recipient,'Friend'))+(sent?'<p>Invitation sent.</p>':'<p>Automatic delivery needs a retry. You can share the private link yourself now.</p>');
    if(!sent&&row.channel==='sms'){
     const link=new URL(giftLink(token),process.env.APP_URL).href;
     result+='<p><a class="btn" href="'+escape('sms:'+row.destination+'?body='+encodeURIComponent('Open your storybook gift: '+link))+'">Open text message</a></p>';
    }
   }
   send(res,200,page('Your storybook gifts',result));return true;
  }
  const data=method==='POST'?await form(req):null;
  const gift=method==='POST'?data?.get('gift'):url.searchParams.get('gift');
  if(!hex(gift)){send(res,404,page('Gift link unavailable','<p>Open the private link from your gift message.</p>'));return true;}
  const key=hash(gift);
  const row=(await pool.query('SELECT * FROM aom_storybook_claims WHERE token_hash=$1',[key])).rows[0];
  if(!row){send(res,404,page('Gift link unavailable','<p>Open the private link from your gift message.</p>'));return true;}
  // A gift's high-entropy private link authorizes the download: recipients
  // choose a language and press Download. No PIN, sign-in or purchase prompt.
  // Sent free and paid gifts stay valid; short-lived QA gifts honour expiry.
  const giftSource=(await pool.query(
   'SELECT kind,expires_at FROM aom_storybook_sources WHERE source_hash=$1',[row.source_hash])).rows[0];
  const directGift=['free','paid'].includes(giftSource?.kind)||
   (giftSource?.kind==='qa'&&giftSource.expires_at&&new Date(giftSource.expires_at)>new Date());
  if(directGift&&method==='GET'&&path==='/storybook/download-all'){
   const selected=url.searchParams.get('language');
   if(!Object.hasOwn(languages,selected)){send(res,400,'Choose a valid language','text/plain');return true;}
   try{await sendLanguageZip(pool,res,selected);}
   catch(error){console.error('Gift ZIP failed',error?.code||error?.name,error?.message||'');if(!res.headersSent)send(res,500,'Download unavailable','text/plain');else res.destroy();}
   return true;
  }
  if(directGift&&method==='GET'&&path==='/storybook/gift'){
   send(res,200,await giftDownloadPage({pool,req,requested:url.searchParams.get('language'),
    recipient:displayName(row.recipient,'Friend'),sender:displayName(row.sender,'Someone special'),
    action:'/storybook/download-all',hidden:{gift}}));return true;
  }
  if(path==='/storybook/gift'&&method==='GET'){
   const wantedBook=url.searchParams.get('book');
   const bulkRequested=url.searchParams.get('download')==='all';
   const already=activeCookie(req,gift);
   if(row.used_at&&hex(already)&&row.session_hash&&equal(hash(already),row.session_hash)&&!row.finished_at&&new Date(row.session_expires)>new Date()){
    const readyBooks=await availableLanguageBooks(pool,row.language);
    const target=bulkRequested&&readyBooks.length?urlFor('/storybook/download-all',{gift})
     :wantedBook&&readyBooks.includes(wantedBook)?urlFor('/storybook/read',{gift,slug:wantedBook}):urlFor('/storybook/shelf',{gift});
    redirect(res,target);return true;
   }
   const selected=url.searchParams.get('language');
   const lang=row.language||(Object.hasOwn(languages,selected)?selected:'en');
   const labels=copy[lang]||copy.en;
   const requestedFields=(bulkRequested?'<input type="hidden" name="download" value="all">':'')+(isBundleBook(wantedBook)&&wantedBook!=='emir-meets-zachary'?'<input type="hidden" name="book" value="'+escape(wantedBook)+'">':'');
   const formHtml=row.used_at?'<p>'+labels[0]+'</p><a class="open" href="'+SITE+'">Visit the website</a>':
    '<form action="/storybook/open" method="post"><input type="hidden" name="gift" value="'+gift+'">'+requestedFields+'<label id="languageLabel" for="language">'+labels[5]+'</label><select id="language" name="language">'+options(lang)+'</select><label id="codeLabel" for="code">'+labels[6]+'</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" required><button class="open" id="open">'+labels[4]+'</button></form>';
   const notice={wrong:'That code did not match. Check your gift message.',locked:'Too many attempts. Ask the gift organizer for help.',edition:'This language edition is still being prepared. Your code is ready to use later.'}[url.searchParams.get('notice')]||'';
   const html=(await template()).replace('<html lang="en">','<html lang="'+lang+'">').replace('%%RECIPIENT%%',()=>escape(displayName(row.recipient,'Friend'))).replace('%%SENDER%%',()=>escape(displayName(row.sender,'Someone special')))
    .replace('%%NOTICE%%',()=>notice?'<p role="status">'+notice+'</p>':'').replace('%%FORM%%',()=>formHtml);
   send(res,200,html);return true;
  }
  if(path==='/storybook/open'&&method==='POST'){
   if(row.used_at){redirect(res,giftLink(gift));return true;}
   if(row.attempts>=8){redirect(res,urlFor('/storybook/gift',{gift,notice:'locked'}));return true;}
   const pin=data?.get('code')||'', lang=data?.get('language');
   if(!/^\d{4}$/.test(pin)||!equal(codeFor(gift),pin)){
    await pool.query('UPDATE aom_storybook_claims SET attempts=attempts+1 WHERE token_hash=$1 AND used_at IS NULL AND attempts<8',[key]);
    redirect(res,urlFor('/storybook/gift',{gift,notice:'wrong',language:lang||'en'}));return true;
   }
   if(!Object.hasOwn(languages,lang)||!(await availableLanguageBooks(pool,lang)).length){
    redirect(res,urlFor('/storybook/gift',{gift,notice:'edition',language:lang||'en'}));return true;
   }
   const session=randomBytes(32).toString('hex');
   const q=await pool.query("UPDATE aom_storybook_claims SET used_at=now(),language=$2,session_hash=$3,session_expires=now()+interval '1 hour' WHERE token_hash=$1 AND used_at IS NULL AND attempts<8 RETURNING token_hash",[key,lang,hash(session)]);
   if(!q.rowCount){redirect(res,giftLink(gift));return true;}
   const requestedBook=data?.get('book'),requestedBulk=data?.get('download')==='all';
   const available=await availableLanguageBooks(pool,lang);
   const destination=requestedBulk?urlFor('/storybook/download-all',{gift}):
    requestedBook&&available.includes(requestedBook)?urlFor('/storybook/read',{gift,slug:requestedBook}):urlFor('/storybook/shelf',{gift});
   redirect(res,destination,{'Set-Cookie':cookie(gift,session,3600)});return true;
  }
  const session=activeCookie(req,gift);
  if(!hex(session)||!row.session_hash||!equal(hash(session),row.session_hash)||row.finished_at||new Date(row.session_expires)<=new Date()){
   if(path==='/storybook/pdf'){send(res,403,'Download session closed','text/plain');return true;}
   redirect(res,giftLink(gift));return true;
  }
  const lang=row.language,labels=copy[lang]||copy.en;
  if(path==='/storybook/finish'&&method==='POST'){
   await pool.query('UPDATE aom_storybook_claims SET finished_at=now(),session_hash=NULL WHERE token_hash=$1 AND session_hash=$2',[key,hash(session)]);
   redirect(res,SITE,{'Set-Cookie':cookie(gift,'',0)});return true;
  }
  const slugs=await availableLanguageBooks(pool,lang);
  const slug=url.searchParams.get('slug');
  if(method==='GET'&&path==='/storybook/download-all'){
   if(!slugs.length){send(res,404,'No approved books available','text/plain');return true;}
   try{await deliverAllBooks(pool,res,slugs,lang);}
   catch(error){console.error('Secure book ZIP delivery failed',error?.code||error?.name,error?.message||'');if(!res.headersSent)send(res,500,'Download unavailable','text/plain');else res.destroy();}
   return true;
  }
  if(method==='GET'&&path==='/storybook/pdf'&&(slugs.includes(slug)||(slug===bundleSlug&&slugs.length===12&&await bundleReady(pool,lang)))){
   await deliverFile(pool,res,slug,lang,slug!==bundleSlug&&url.searchParams.get('inline')==='1');return true;
  }
  if(method==='GET'&&path==='/storybook/read'&&slugs.includes(slug)){
   const inline=urlFor('/storybook/pdf',{gift,slug,inline:'1'});
   const title=bundleTitle(slug,lang);
   send(res,200,page(title,'<p><a class="btn" href="'+escape(urlFor('/storybook/shelf',{gift}))+'">‹ '+escape(languages[lang])+'</a></p><iframe style="width:100%;height:75vh;border:0" title="'+escape(title)+'" src="'+escape(inline)+'"></iframe><p><a href="'+escape(inline)+'">Open PDF</a></p>',lang));return true;
  }
  if(path==='/storybook/shelf'&&method==='GET'){
   const allLabel={en:'Download all available books (ZIP)',de:'Alle verfügbaren Bücher herunterladen (ZIP)','pt-PT':'Descarregar todos os livros disponíveis (ZIP)',tr:'Tüm mevcut kitapları indir (ZIP)',es:'Descargar todos los libros disponibles (ZIP)',fr:'Télécharger tous les livres disponibles (ZIP)'}[lang]||'Download all available books (ZIP)';
   const bulkAction=slugs.length?'<p><a class="button" href="'+escape(urlFor('/storybook/download-all',{gift}))+'">'+escape(allLabel)+' ('+slugs.length+')</a></p>':'';
   const merged=slugs.length===12&&await bundleReady(pool,lang);const actions='<div style="background:#fff2cc;text-align:center;padding:12px"><strong>'+labels[3]+'</strong>'+bulkAction+(merged?'<p><a class="button" href="'+escape(urlFor('/storybook/pdf',{gift,slug:bundleSlug}))+'">'+labels[1]+'</a></p>':'')+'<form method="post" action="/storybook/finish"><input type="hidden" name="gift" value="'+gift+'"><button class="button secondary">'+labels[2]+'</button></form></div>';
   const html=shelfPage({lang,available:slugs,otherEditions:[],order:slugs,link:(view,book)=>urlFor(view==='reader'?'/storybook/read':'/storybook/pdf',{gift,slug:book})})
    .replace('content="no-referrer"','content="strict-origin"').replace('<ul class="books">',()=>actions+'<ul class="books">');
   send(res,200,html);return true;
  }
  send(res,404,page('Book unavailable',''));return true;
 }catch(error){
  console.error('Storybook request failed',error.code||error.name);
  if(res.headersSent)res.destroy();else send(res,503,page('Please try again','<p>The storybook service is temporarily unavailable.</p>'));
  return true;
 }
}
