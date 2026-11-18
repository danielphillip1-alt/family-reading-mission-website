// Free QR gift: read any approved book online, page by page, on any phone,
// tablet or computer (PDF.js renders the pages, so Android phones read in the
// browser instead of downloading), plus the language shelf for the gift pages.
import {readFile} from 'node:fs/promises';
// PDF.js (Apache-2.0) is served from this backend, not a public CDN. Phones that
// support it get 3.11.174; older phones and in-app browsers (before iOS 15.4 /
// Chrome 92) get the 2.16.105 legacy build, which runs back to iOS 12.
export const PDFJS_VERSIONS={'3.11.174':'pdfjs-3.11.174','2.16.105-legacy':'pdfjs-2.16.105-legacy'};
export const PDFJS_VERSION='3.11.174';
const PDFJS_MODERN='/barber/pdfjs/3.11.174',PDFJS_LEGACY='/barber/pdfjs/2.16.105-legacy';
const pdfjsFiles=new Set(['pdf.min.js','pdf.worker.min.js']);
const pdfjsCache=new Map();
export async function pdfjsAsset(name,version=PDFJS_VERSION){
 if(!pdfjsFiles.has(name)||!Object.hasOwn(PDFJS_VERSIONS,version))return null;
 const key=version+'/'+name;
 if(!pdfjsCache.has(key))pdfjsCache.set(key,await readFile(new URL('./vendor/'+PDFJS_VERSIONS[version]+'/'+name,import.meta.url)));
 return pdfjsCache.get(key);
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const readerWords={
 en:{back:'Books',download:'Download',prev:'Previous page',next:'Next page',page:'Page',opening:'Opening the book…',failed:'Tap below to open the book.',open:'Open the book',book:'Book'},
 de:{back:'Bücher',download:'Herunterladen',prev:'Vorherige Seite',next:'Nächste Seite',page:'Seite',opening:'Das Buch wird geöffnet …',failed:'Tippe unten, um das Buch zu öffnen.',open:'Buch öffnen',book:'Buch'},
 fr:{back:'Livres',download:'Télécharger',prev:'Page précédente',next:'Page suivante',page:'Page',opening:'Ouverture du livre…',failed:'Touche le bouton ci-dessous pour ouvrir le livre.',open:'Ouvrir le livre',book:'Livre'},
 es:{back:'Libros',download:'Descargar',prev:'Página anterior',next:'Página siguiente',page:'Página',opening:'Abriendo el libro…',failed:'Toca abajo para abrir el libro.',open:'Abrir el libro',book:'Libro'},
 tr:{back:'Kitaplar',download:'İndir',prev:'Önceki sayfa',next:'Sonraki sayfa',page:'Sayfa',opening:'Kitap açılıyor…',failed:'Kitabı açmak için aşağıya dokun.',open:'Kitabı aç',book:'Kitap'},
 'pt-PT':{back:'Livros',download:'Descarregar',prev:'Página anterior',next:'Página seguinte',page:'Página',opening:'A abrir o livro…',failed:'Toca abaixo para abrir o livro.',open:'Abrir o livro',book:'Livro'}
};

export function readerPage(book){
 const w=readerWords[book.lang]||readerWords.en;
 const q='slug='+encodeURIComponent(book.slug)+'&language='+encodeURIComponent(book.lang);
 const pdf='/barber/free-book.pdf?'+q;
 const back='https://theauthorsmission.de/gift.html?language='+encodeURIComponent(book.lang);
 return `<!doctype html><html lang="${esc(book.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>${esc(book.title)} | Authors On A Mission</title>
<style>
:root{--green:#0d4536;--deep:#0a3428;--gold:#e8b84a;--cream:#fff7e3}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--deep);color:#fff;font-family:Georgia,'Times New Roman',serif;overscroll-behavior:none}
header{position:fixed;top:0;left:0;right:0;z-index:3;display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:var(--green);box-shadow:0 2px 10px #0006}
header a{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:42px;padding:0 14px;border-radius:999px;font-weight:700;font-size:16px;text-decoration:none}
#back{background:var(--cream);color:var(--green)}#dl{background:var(--gold);color:#3b2600}
.t{flex:1;min-width:0;text-align:center;line-height:1.15}.t b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t small{font-size:12px;opacity:.8}
main{position:fixed;left:0;right:0;top:var(--top,64px);bottom:var(--bottom,74px);display:flex;align-items:center;justify-content:center;padding:8px;touch-action:pan-y pinch-zoom}
canvas{display:block;max-width:100%;max-height:100%;background:#fff;border-radius:6px;box-shadow:0 8px 28px #0008}
footer{position:fixed;left:0;right:0;bottom:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px calc(env(safe-area-inset-bottom) + 10px);background:var(--green)}
footer button{min-width:76px;min-height:52px;border:0;border-radius:16px;background:var(--gold);color:#3b2600;font-size:30px;line-height:1;font-weight:700;cursor:pointer}
footer button:disabled{opacity:.3;cursor:default}#count{font-size:18px;font-weight:700}
#status{position:fixed;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;font-size:20px}
#status a{color:var(--deep);background:var(--gold);padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700}
@media (min-width:700px){header a{font-size:17px}.t b{font-size:19px}}
</style></head><body>
<header><a id="back" href="${esc(back)}">← ${esc(w.back)}</a><div class="t"><b>${esc(book.title)}</b><small>${esc(book.series)} · ${esc(w.book)} ${book.number}</small></div><a id="dl" href="${esc(pdf)}&amp;download=1">⬇ <span class="lbl">${esc(w.download)}</span></a></header>
<main id="stage"><img id="cover" src="/storybook/cover?${esc(q)}" alt="" style="max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 8px 28px #0008"><canvas id="page" role="img" aria-label="${esc(book.title)}" style="display:none"></canvas></main>
<footer><button id="prev" type="button" aria-label="${esc(w.prev)}">‹</button><span id="count" aria-live="polite"></span><button id="next" type="button" aria-label="${esc(w.next)}">›</button></footer>
<div id="status" style="top:auto;bottom:calc(var(--bottom,74px) + 12px);inset-inline:0;font-size:16px;pointer-events:none"><span style="background:#0d4536e6;padding:8px 16px;border-radius:999px">${esc(w.opening)}</span></div>
<script>
(()=>{'use strict';
const W=${JSON.stringify(w)},URL_=${JSON.stringify(pdf)},KEY='aom_page_'+${JSON.stringify(book.slug+':'+book.lang)},SLUG=${JSON.stringify(book.slug)},LANG=${JSON.stringify(book.lang)};
const MODERN=(()=>{try{if(/[?&]legacy=1/.test(location.search)||typeof [].at!=='function'||typeof structuredClone!=='function')return false;new Function('class A{#p(){return 1}}');return true;}catch(e){return false;}})();
const STREAM_DEFAULT=false;
const BUILD=MODERN?${JSON.stringify(PDFJS_MODERN)}:${JSON.stringify(PDFJS_LEGACY)};
const canvas=document.getElementById('page'),stage=document.getElementById('stage'),status=document.getElementById('status');
const prev=document.getElementById('prev'),next=document.getElementById('next'),count=document.getElementById('count');
const back=document.getElementById('back');
try{if(document.referrer&&new URL(document.referrer).hostname.endsWith('theauthorsmission.de'))back.addEventListener('click',e=>{e.preventDefault();history.back();});}catch(e){}
const INAPP=/FBAN|FBAV|FB_IAB|Instagram|Line\\/|GSA\\/|Snapchat|TikTok|musical_ly|Twitter|Pinterest|; wv\\)/i.test(navigator.userAgent);
if(INAPP)document.getElementById('dl').href=URL_;
if(innerWidth<380)document.querySelector('#dl .lbl').remove();
function layout(){document.documentElement.style.setProperty('--top',document.querySelector('header').offsetHeight+'px');document.documentElement.style.setProperty('--bottom',document.querySelector('footer').offsetHeight+'px');}
layout();
let doc=null,num=1,target=1,busy=false,queued=null,task=null;
let failed=false,first=false;
function report(stage,msg){try{navigator.sendBeacon&&navigator.sendBeacon('/barber/reader-error',JSON.stringify({slug:SLUG,language:LANG,stage:stage,message:String(msg||'').slice(0,300),build:BUILD,ua:navigator.userAgent.slice(0,250)}));}catch(e){}}
function fail(stage,err){
 if(failed||first)return;failed=true;report(stage,err&&(err.message||err.name||err));
 status.removeAttribute('style');while(status.firstChild)status.removeChild(status.firstChild);
 const p=document.createElement('p');p.textContent=W.failed;
 const o=document.createElement('a');o.href=URL_;o.textContent='📖 '+W.open;
 const a=document.createElement('a');a.href=INAPP?URL_:URL_+'&download=1';a.textContent='⬇ '+W.download;a.style.background='#fff7e3';
 status.append(p,o,a);status.style.display='flex';status.style.background='rgba(10,52,40,.82)';
}
async function show(n){
 if(!doc)return;n=Math.max(1,Math.min(doc.numPages,n));
 if(busy){queued=n;return;}busy=true;num=n;
 try{
  const page=await doc.getPage(n);const base=page.getViewport({scale:1});
  const box=stage.getBoundingClientRect();const fit=Math.min((box.width-16)/base.width,(box.height-16)/base.height);
  const ratio=Math.min(window.devicePixelRatio||1,2.5);const vp=page.getViewport({scale:fit*ratio});
  const off=document.createElement('canvas');off.width=Math.floor(vp.width);off.height=Math.floor(vp.height);
  await page.render({canvasContext:off.getContext('2d'),viewport:vp}).promise;
  canvas.width=off.width;canvas.height=off.height;canvas.getContext('2d').drawImage(off,0,0);
  canvas.style.width=Math.floor(base.width*fit)+'px';canvas.style.height=Math.floor(base.height*fit)+'px';
  first=true;status.style.display='none';const cov=document.getElementById('cover');if(cov)cov.remove();canvas.style.display='block';
  count.textContent=W.page+' '+n+' / '+doc.numPages;prev.disabled=n<=1;next.disabled=n>=doc.numPages;
  try{localStorage.setItem(KEY,String(n));}catch(e){}
  if(n<doc.numPages)doc.getPage(n+1).catch(()=>{});
 }catch(e){fail('render',e);}
 busy=false;if(queued!==null){const q=queued;queued=null;show(q);}
}
function step(d){if(!doc)return;target=Math.max(1,Math.min(doc.numPages,target+d));show(target);}
prev.addEventListener('click',()=>step(-1));next.addEventListener('click',()=>step(1));
addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();step(1);}if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}});
let sx=0,sy=0,multi=false;
stage.addEventListener('touchstart',e=>{multi=e.touches.length>1;sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
stage.addEventListener('touchend',e=>{if(multi||(window.visualViewport&&visualViewport.scale>1.05))return;const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;
 if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)step(dx<0?1:-1);
 else if(Math.abs(dx)<10&&Math.abs(dy)<10){const r=stage.getBoundingClientRect();if(t.clientX>r.left+r.width*.66)step(1);else if(t.clientX<r.left+r.width*.34)step(-1);}},{passive:true});
let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{layout();show(num);},150);});
setTimeout(()=>{if(!first)fail('slow','no page after 25 s');},25000);
const lib=document.createElement('script');lib.src=BUILD+'/pdf.min.js';
lib.onerror=()=>fail('library','script failed to load');
lib.onload=()=>{
 if(!window.pdfjsLib){fail('library','pdfjsLib missing');return;}
 try{
  pdfjsLib.GlobalWorkerOptions.workerSrc=BUILD+'/pdf.worker.min.js';
  const STREAM=/[?&]mode=stream/.test(location.search)?true:/[?&]mode=ranges/.test(location.search)?false:STREAM_DEFAULT;
  task=pdfjsLib.getDocument(STREAM?{url:URL_,disableRange:true,disableStream:false,isEvalSupported:false}:{url:URL_,rangeChunkSize:2097152,disableAutoFetch:false,disableStream:false,isEvalSupported:false});
  task.promise.then(d=>{doc=d;let start=1;try{start=Number(localStorage.getItem(KEY))||1;}catch(e){}if(start>=d.numPages)start=1;target=start;show(start);}).catch(e=>fail('open',e));
 }catch(e){fail('init',e);}
};
document.head.appendChild(lib);
})();
</script></body></html>`;
}

// Language shelf for the gift pages: one row per language, the child's chosen
// language first; every cover opens the reader and every book can be saved.
export const shelfScript=String.raw`(()=>{'use strict';
const me=document.currentScript,backend=new URL(me.src).origin;
const host=document.getElementById('aom-shelf');if(!host)return;
const order=['en','de','fr','es','tr','pt-PT'];
const names={en:'🇬🇧 English',de:'🇩🇪 Deutsch',fr:'🇫🇷 Français',es:'🇪🇸 Español',tr:'🇹🇷 Türkçe','pt-PT':'🇵🇹 Português'};
const T={
 en:{title:'Read the books right here',intro:'Find your language, tap a book and start reading. You can also download any book to keep.',read:'Read',dl:'Download',books:'books',book:'Book'},
 de:{title:'Lies die Bücher gleich hier',intro:'Such deine Sprache, tippe auf ein Buch und fang an zu lesen. Du kannst jedes Buch auch herunterladen.',read:'Lesen',dl:'Herunterladen',books:'Bücher',book:'Buch'},
 fr:{title:'Lis les livres ici même',intro:'Trouve ta langue, touche un livre et commence à lire. Tu peux aussi télécharger chaque livre.',read:'Lire',dl:'Télécharger',books:'livres',book:'Livre'},
 es:{title:'Lee los libros aquí mismo',intro:'Busca tu idioma, toca un libro y empieza a leer. También puedes descargar cualquier libro.',read:'Leer',dl:'Descargar',books:'libros',book:'Libro'},
 tr:{title:'Kitapları hemen burada oku',intro:'Dilini bul, bir kitaba dokun ve okumaya başla. İstediğin kitabı indirip saklayabilirsin de.',read:'Oku',dl:'İndir',books:'kitap',book:'Kitap'},
 'pt-PT':{title:'Lê os livros aqui mesmo',intro:'Procura o teu idioma, toca num livro e começa a ler. Também podes descarregar qualquer livro.',read:'Ler',dl:'Descarregar',books:'livros',book:'Livro'}
};
const css=document.createElement('style');css.textContent=['#aom-shelf{max-width:1122px;margin:0 auto;padding:22px 0 30px;background:linear-gradient(#fff8e6,#fdf0cf);color:#123c31;font-family:Georgia,"Times New Roman",serif}','#aom-shelf .aom-head{padding:0 16px 6px;text-align:center}','#aom-shelf h2{margin:0 0 6px;font-size:clamp(22px,5.4vw,32px);color:#0d4536}','#aom-shelf .aom-intro{margin:0 auto;max-width:620px;font-size:clamp(15px,3.8vw,18px);line-height:1.4}','#aom-shelf .aom-row{margin:18px 0 0}','#aom-shelf h3{display:flex;align-items:baseline;gap:8px;margin:0 16px 8px;font-size:clamp(18px,4.6vw,23px);color:#0d4536}','#aom-shelf h3 small{font-size:14px;font-weight:400;color:#6b5a36}','#aom-shelf .aom-row.first h3{color:#8f1c1c}','#aom-shelf .aom-track{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 16px 12px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}','#aom-shelf .aom-card{flex:0 0 clamp(132px,36vw,170px);scroll-snap-align:start;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(70,45,0,.18);overflow:hidden}','#aom-shelf .aom-cover{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;background:#f3ead2}','#aom-shelf .aom-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}','#aom-shelf .aom-meta{padding:8px 9px 0;flex:1}','#aom-shelf .aom-num{font-size:12px;color:#7a6438;text-transform:uppercase;letter-spacing:.03em}','#aom-shelf .aom-title{margin-top:3px;font-size:14px;line-height:1.25;font-weight:700;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}','#aom-shelf .aom-actions{display:flex;gap:6px;padding:9px}','#aom-shelf .aom-actions a{display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px}','#aom-shelf .aom-read{flex:1;background:#0d4536;color:#fff}','#aom-shelf .aom-dl{flex:0 0 42px;background:#f3d27a;color:#3b2600}','#aom-shelf .aom-read:focus-visible,#aom-shelf .aom-dl:focus-visible,#aom-shelf .aom-cover:focus-visible{outline:3px solid #8f1c1c;outline-offset:2px}'].join('\n');
document.head.append(css);
let lang=host.dataset.language||'en',data=null;
const INAPP=/FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|Snapchat|TikTok|musical_ly|Twitter|Pinterest|; wv\)/i.test(navigator.userAgent);
const sel=document.querySelector('select#language,select[name="language"]');
if(sel&&order.includes(sel.value))lang=sel.value;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function render(){
 if(!data)return;const ui=T[lang]||T.en;while(host.firstChild)host.removeChild(host.firstChild);host.lang=lang;
 const head=el('div','aom-head');head.append(el('h2','',ui.title),el('p','aom-intro',ui.intro));host.append(head);
 const rows=[...data].filter(r=>r.books.length).sort((a,b)=>(a.language===lang?-1:b.language===lang?1:order.indexOf(a.language)-order.indexOf(b.language)));
 rows.forEach((row,i)=>{
  const w=T[row.language]||T.en;const sec=el('section','aom-row'+(i===0?' first':''));sec.lang=row.language;
  const h=el('h3','',names[row.language]||row.label);h.append(el('small','',row.books.length+' '+w.books));sec.append(h);
  const track=el('div','aom-track');track.setAttribute('role','list');
  for(const b of row.books){
   const q=new URLSearchParams({slug:b.slug,language:row.language});
   const read=backend+'/barber/read?'+q,dl=backend+'/barber/free-book.pdf?'+q+(INAPP?'':'&download=1');
   const card=el('article','aom-card');card.setAttribute('role','listitem');
   const cover=el('a','aom-cover');cover.href=read;cover.setAttribute('aria-label',w.read+': '+b.title);
   const img=el('img');img.loading='lazy';img.alt='';img.src=backend+'/storybook/cover?'+q;cover.append(img);
   const meta=el('div','aom-meta');meta.append(el('div','aom-num',b.series+' · '+w.book+' '+b.number),el('div','aom-title',b.title));
   const acts=el('div','aom-actions');const r=el('a','aom-read','📖 '+w.read);r.href=read;
   const d=el('a','aom-dl','⬇');d.href=dl;d.setAttribute('aria-label',w.dl+': '+b.title);d.title=w.dl;
   acts.append(r,d);card.append(cover,meta,acts);track.append(card);
  }
  sec.append(track);host.append(sec);
 });
}
fetch(backend+'/barber/free-library',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(d&&Array.isArray(d.languages)){data=d.languages;render();}}).catch(()=>{});
document.addEventListener('aom:language',e=>{if(order.includes(e.detail)){lang=e.detail;render();}});
if(sel)sel.addEventListener('change',()=>{if(order.includes(sel.value)){lang=sel.value;render();}});
})();`;
