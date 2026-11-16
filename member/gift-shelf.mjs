import {giftArt} from './gift-shelf-art.mjs';

export const bundleBooks = [
 ['zachary-my-unique-hat-2026-11','Zachary and the “My Unique” Hat','Zachary und der „My Unique“-Hut','Zachary e o Chapéu My Unique'],
 ['zachary-school-that-believed-in-him','Zachary and the School That Believed in Him','Zachary und die Schule, die an ihn glaubte','Zachary e a Escola que Acreditou Nele'],
 ['zachary-school-that-made-room','Zachary and the School That Made Room','Zachary und die Schule, die Platz machte','Zachary e a Escola que Abriu Espaço'],
 ['emir-boy-who-never-smiles','Emir and the Boy Who Never Smiles'],
 ['emir-barbershop-boys-and-salon-girls','Emir and the Barbershop Boys and Salon Girls'],
];
export const isBundleBook = slug => /^(zachary|emir)-[a-z0-9-]{2,70}$/.test(slug||'');
export const bundleTitle = (slug,lang) => {
 const row=bundleBooks.find(book=>book[0]===slug);
 return row?.[{en:1,de:2,'pt-PT':3}[lang]]||row?.[1]||slug.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());
};
const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words={
 en:{title:'Your storybook gift!',intro:'Zachary and Emir’s adventures, together in one gift. Pick a book to start reading!',read:'Open book',download:'Download PDF',save:'Be sure to download your books so you can read them again anytime.',missing:'Not yet available in this language'},
 de:{title:'Dein Büchergeschenk!',intro:'Die Abenteuer von Zachary und Emir in einem Geschenk. Such dir ein Buch aus und lies los!',read:'Buch öffnen',download:'PDF herunterladen',save:'Lade deine Bücher herunter, damit du sie jederzeit wieder lesen kannst.',missing:'In dieser Sprache noch nicht verfügbar'},
 'pt-PT':{title:'O teu presente de livros!',intro:'As aventuras de Zachary e Emir num só presente. Escolhe um livro e começa a ler!',read:'Abrir livro',download:'Descarregar PDF',save:'Descarrega os teus livros para os poderes ler novamente sempre que quiseres.',missing:'Ainda indisponível neste idioma'}
};
const style=`
:root{color-scheme:light;--forest:#063a2b;--gold:#f4cf76;--ink:#143324;--berry:#8e151b}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% 18%,#165b3d,transparent 60%),#042a20;color:var(--ink);font:16px/1.45 Georgia,serif}
main{max-width:1100px;margin:auto;background:#fff2cd;box-shadow:0 0 70px #00180d}
.hero{display:block;width:100%;height:auto}
.intro{text-align:center;padding:24px 18px 20px;background:radial-gradient(ellipse at top,#fffdeb,#ffe4a1);border-block:4px double #ba852a}
h1{margin:0;color:var(--berry);font-size:clamp(2.15rem,6vw,4.6rem);line-height:1.04;text-shadow:0 2px #fff4bd}
.intro p{margin:11px auto 0;max-width:560px;font-size:clamp(1rem,2.4vw,1.3rem)}
.save{font-weight:bold}
.books{list-style:none;margin:0;padding:clamp(14px,4vw,42px);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:clamp(14px,2.6vw,26px);background:radial-gradient(ellipse at 50% 0,#ffeab0,#f5d28b)}
.book{display:flex;flex-direction:column;align-items:center;text-align:center;border:2px solid #b77b2b;border-radius:17px;padding:16px;background:linear-gradient(160deg,#fffdf0,#fff4d8);box-shadow:0 8px 0 #ad6d24,0 13px 18px #663c222e}
.cover{width:100%;aspect-ratio:1/1.04;display:grid;place-items:center;background:radial-gradient(ellipse,#f4d684,#e8c97a 55%,#f7e1a2 72%);border-radius:12px}
.cover img{display:block;width:auto;max-width:87%;height:90%;object-fit:contain;box-shadow:5px 6px 8px #38282d75;border-radius:3px}
.placeholder{display:grid;place-items:center;width:68%;height:82%;padding:12px;background:#0a503a;color:#ffe19a;border:4px double currentColor;border-radius:5px;font-weight:bold}
h2{font-size:1.22rem;line-height:1.18;min-height:2.36em;margin:13px 0;display:grid;place-items:center}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;align-items:center;margin-top:auto}
.button{display:inline-block;padding:9px 13px;border-radius:50px;background:var(--berry);color:#fff8dd;font-weight:bold;text-decoration:none;border:2px solid #f1c66b}
.secondary{background:var(--forest)}a:focus-visible{outline:3px solid var(--forest);outline-offset:3px}
footer{text-align:center;background:var(--forest);color:#ffe59d;padding:17px;font-weight:bold}
@media(max-width:560px){.books{grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.book{padding:8px}.intro{padding:15px 12px}h2{font-size:1rem}.button{font-size:.83rem;padding:6px 9px}.cover{aspect-ratio:1/1.12}}
`;
export function shelfPage({lang,available,otherEditions,link}){
 const w=words[lang];
 const slugs=[...new Set([...bundleBooks.map(b=>b[0]),...available,...otherEditions])].filter(slug=>available.includes(slug)||otherEditions.includes(slug));
 const cards=slugs.map(slug=>{
  const title=escape(bundleTitle(slug,lang));
  const cover=giftArt[slug]?'<img src="'+giftArt[slug]+'" alt="">':'<span class="placeholder">'+title+'</span>';
  const actions=available.includes(slug)?'<a class="button" href="'+escape(link('reader',slug))+'" aria-label="'+escape(w.read+' – '+bundleTitle(slug,lang))+'">'+w.read+'</a> <a class="button secondary" href="'+escape(link('reader-pdf',slug))+'" aria-label="'+escape(w.download+' – '+bundleTitle(slug,lang))+'">'+w.download+'</a>':'<span>'+w.missing+'</span>';
  return '<li class="book"><div class="cover">'+cover+'</div><h2>'+title+'</h2><div class="actions">'+actions+'</div></li>';
 }).join('');
 return '<!doctype html><html lang="'+lang+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>'+w.title+'</title><style>'+style+'</style><main><img class="hero" alt="" src="'+giftArt['gift-hero']+'"><header class="intro"><h1>'+w.title+'</h1><p>'+w.intro+'</p><p class="save">'+w.save+'</p></header><ul class="books">'+cards+'</ul><footer>Authors On A Mission</footer></main></html>';
}
