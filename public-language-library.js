/* Authors On A Mission — server-verified multilingual book index. No PDF is linked without an authenticated gift. */
(()=>{
 const base='https://authors-on-a-mission-members.onrender.com';
 const root=document.querySelector('#aom-language-library');
 if(!root)return;
 const title={
  'zachary-my-unique-hat-2026-11':{en:'Zachary and the My Unique Hat',de:'Zachary und der „My Unique“-Hut','pt-PT':'Zachary e o Chapéu My Unique'},
  'zachary-school-that-believed-in-him':{en:'Zachary and the School That Believed in Him',de:'Zachary und die Schule, die an ihn glaubte','pt-PT':'Zachary e a Escola que Acreditou Nele'},
  'zachary-school-that-made-room':{en:'Zachary and the School That Made Room',de:'Zachary und die Schule, die Platz machte','pt-PT':'Zachary e a Escola que Abriu Espaço'},
  'emir-boy-who-never-smiles':{en:'Emir and the Boy Who Never Smiles',de:'Emir und der Junge, der nie lächelt',tr:'Emir ve Hiç Gülümsemeyen Çocuk',fr:'Emir et le garçon qui ne souriait jamais',es:'Emir y el niño que nunca sonríe'},
  'emir-barbershop-boys-and-salon-girls':{en:'Emir and the Barbershop Boys and Salon Girls',de:'Emir und die Barbershop-Jungs und Salon-Mädchen',tr:'Emir ve Berber Dükkânının Çocukları ve Kuaför Salonunun Kızları',fr:'Emir et les garçons du salon de coiffure et les filles du salon',es:'Emir y los chicos de la barbería y las chicas del salón'}
 };
 const languages={en:'English',de:'Deutsch',tr:'Türkçe',es:'Español',fr:'Français','pt-PT':'Português'};
 const h=document.createElement('h2');h.textContent='Books by language';root.append(h);
 const desc=document.createElement('p');desc.textContent='Browse editions that have passed the private library publishing checks. Your personal gift link unlocks reading and PDF downloads.';root.append(desc);
 const nav=document.createElement('div');nav.className='aom-language-tabs';nav.setAttribute('role','group');nav.setAttribute('aria-label','Book language');
 const listing=document.createElement('div');listing.className='aom-language-listing';listing.setAttribute('aria-live','polite');
 root.append(nav,listing);
 let chosen='en',verified=[];
 const show=()=>{
  nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.language===chosen)));
  listing.replaceChildren();
  const list=verified.filter(x=>x.language===chosen&&title[x.slug]);
  if(!list.length){const p=document.createElement('p');p.textContent='No approved editions currently available in this language.';listing.append(p);return;}
  const ul=document.createElement('ul');ul.className='aom-language-books';
  for(const e of list){
   const li=document.createElement('li'),name=document.createElement('strong'),series=document.createElement('small');
   name.textContent=title[e.slug]?.[chosen]||title[e.slug]?.en||e.slug;
   series.textContent=e.slug.startsWith('emir-')?'Emir collection':'Zachary collection';
   li.append(name,series);ul.append(li);
  }
  listing.append(ul);
 };
 for(const [language,label] of Object.entries(languages)){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.language=language;
  b.setAttribute('aria-pressed',String(language===chosen));
  b.addEventListener('click',()=>{chosen=language;show();});
  nav.append(b);
 }
 const load=async()=>{
  try{
   const response=await fetch(base+'/api/storybook/catalog',{cache:'no-store',mode:'cors'});
   if(!response.ok)throw Error('catalog unavailable');
   const result=await response.json();
   if(!Array.isArray(result.editions))throw Error('invalid catalog');
   verified=result.editions.filter(e=>typeof e.slug==='string'&&Object.hasOwn(languages,e.language)&&Number(e.size)>100&&/^[0-9a-f]{64}$/i.test(e.sha256||''));
   show();
  }catch{
   listing.textContent='The book library cannot be displayed right now.';
  }
 };
 load();
})();
