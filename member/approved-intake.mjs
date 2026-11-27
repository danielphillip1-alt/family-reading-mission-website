import {createHash} from 'node:crypto';
import {refreshGiftLibrary} from './storybook-gifts.mjs';

// Owner-approved replacement editions (2026-11-17): Zachary Book One in
// English and European Portuguese, each with its original cover included.
// Only these exact files (size + SHA-256) can be ingested, so no secret is
// needed and nothing else can be uploaded. Bytes stay in memory until the
// checksum matches; book content is never written to the public repository.
const approved={
 'my-name-is-love:en':{size:996242,sha256:'e68249fa7983211e1ee7af9b61f5072a944bc818f334d25d96db9887e679614c'},
 'zachary-my-unique-hat-2026-11:en':{size:15080055,sha256:'f31050cdc85bda2e3b9c3787319bde64a8a772b6cc3d46b05d6de63bd675d1ad'},
 'zachary-my-unique-hat-2026-11:pt-PT':{size:12394782,sha256:'cf7b75b3b9838389639fec6cb85134244583c7c9e218f307ea9f63779645a68f'},
 // 2026-11-17: owner-approved English Emir editions, including Emir Book Three.
 'emir-boy-who-never-smiles:en':{size:16217672,sha256:'b3b589b46a629307f74b5e9c043b9b775f572b89030207b81cd982bda06a6a40'},
 'emir-barbershop-boys-and-salon-girls:en':{size:15745828,sha256:'a9d71b15efed769b72b5d094b9bc5ae489a15f766d49c6a3a1984ca438ad6f08'},
 'emir-meets-zachary:en':{size:16747082,sha256:'a35dcd79c4357fe79d658cd4a17884c38bb15bd95aeb16c3bd5619601690a2e5'},
 'emir-meets-zachary:es':{size:17869805,sha256:'dac7f72239bbca376d3a4622f4244c7780263db6d5a5ac779e5509dc56d530cf'},
 'emir-meets-zachary:de':{size:17870102,sha256:'e2be47f81ee400fd22b8d363b364c3aa6d830aaed5c204449204541654d911e2'},
 'emir-meets-zachary:tr':{size:17870796,sha256:'02ba124bd4652e48237899804ac334725f241b3e7a9eb8c7cfc63bfd8ac23cee'},
 'emir-meets-zachary:fr':{size:20990663,sha256:'bb8f305fe3d6429d9abad1d0ab2dd26620eb3bc80cf09528771f369606196dd2'},
 // Zachary Book Four (English), owner-approved manuscript; only typography change:
 // the "English manuscript · Editorial draft · 8 November 2026" footer was removed.
 'zachary-biggest-lesson-yet:en':{size:26345338,sha256:'e1e6a50138bfeffd20089ac056d04812f8fd3d21ed1a9a4c36049c298070b9a1'},
 // Owner-approved replacement English editions of Zachary Books Two and Three.
 'zachary-school-that-believed-in-him:en':{size:17380946,sha256:'5ac52203a457f355e46d0638f4cd23769681f22f20d33eef7a5ba78fce094082'},
 'zachary-school-that-made-room:en':{size:24320896,sha256:'48b4d8baff838e6d125bafcc9d3a289c23c8b877c450c5bdd6af871ce3ecfbb0'},
 // Owner-approved translations: Zachary Book One (fr, es, tr; covers repainted opaque so
 // no English shows through) and Zachary Book Four (es, de, pt-PT; translated and typeset).
 'zachary-my-unique-hat-2026-11:fr':{size:10440228,sha256:'2b98fb19655f4cba963e3041d4fe390923fef784693ae2acaeb8036025064625'},
 'zachary-my-unique-hat-2026-11:es':{size:10433627,sha256:'fdae0b2e881ce2fd21b9506af7fe76698fa397d9b80f91a76ba932ad48b0f31b'},
 'zachary-my-unique-hat-2026-11:tr':{size:10396319,sha256:'233b67bdcc03bd214721850d39d567a5cbac9ab9a6f7ebb6c8312f83032f2530'},
 'zachary-biggest-lesson-yet:es':{size:22781265,sha256:'4a5c86c722c56e301c5e73ab46b85ae59d78cc3bc85e642431c717a1adca609e'},
 'zachary-biggest-lesson-yet:de':{size:22783762,sha256:'66ff234b31c9b9e9e880c8893b38339c08be1a8e65f623f29a6528b31dfc43e0'},
 'zachary-biggest-lesson-yet:pt-PT':{size:22772405,sha256:'628830a783297684357128bf759b73e33d942bb23b1cf28dada9d4287183854c'},
 // Zachary Book Four translated into French and Turkish.
 'zachary-biggest-lesson-yet:fr':{size:22784164,sha256:'4228bd1329e41a91f662ce43947bcf0165d7b51281f236f1136172fbba04fe00'},
 'zachary-biggest-lesson-yet:tr':{size:22782204,sha256:'c902f1cc97c9761daad782e47fb21a2132843bb95a920e544df9d099f098cd30'},
 'zachary-school-that-believed-in-him:es':{size:12917683,sha256:'30c7da0a9f3f9bfbe24102c27d57219fc0b1f79fa69da936c2ebe3f4ed4948cf'},
 'zachary-school-that-believed-in-him:fr':{size:12913716,sha256:'14aade1f21c637c832148413b51549341b5ac79460506abddb4d59704dd8dc26'},
 'zachary-school-that-believed-in-him:tr':{size:12912538,sha256:'a10507e877fe78945e478cbf1eca2b16bbeddd8b5087507bf8d6f058cdc45593'},
 'zachary-school-that-made-room:es':{size:24322631,sha256:'e2c5186f1c37d015a88c3491f749bbb796f1b57e3586845cd97871479fd2a96b'},
 'zachary-school-that-made-room:fr':{size:24325244,sha256:'c7feaadb215fb44e6cacc6e0165171b38c867bdb6a3cf420bb18fc4ebca876e8'},
 'zachary-school-that-made-room:tr':{size:24324941,sha256:'0764bb9c594e57fd09a4ba97cca88ff980c5fac01f1a4ef68c5b04fc14e3f625'},
 'zachary-foundation-of-something-great:en':{size:9670568,sha256:'92ceb6c0cdf9f23eba58eba2a4f442df4c6366071685da4e25dcc0c204c3a0a2'},
 'zachary-foundation-of-something-great:es':{size:6187379,sha256:'8ca3a7126af6226f46082c3d35afc4ad56c0e959e8744be11d8c98a7dc9ec8d0'},
 'zachary-foundation-of-something-great:fr':{size:6191063,sha256:'7a85a360db46aa4f09134e4cd14b8c9e21d51951efd30ae6c3e65f897eeef72f'},
 'zachary-foundation-of-something-great:de':{size:6193604,sha256:'0b9dea57c067fae9c84e785f279a551f95fd11e83cfcac698f2be3db4b189b16'},
 'zachary-foundation-of-something-great:pt-PT':{size:6188914,sha256:'d7966ccb68d28b9ad7f0c1b2b3cc63713295c383bffda77ed6bde233538567c0'},
 'zachary-foundation-of-something-great:tr':{size:6184937,sha256:'ceda4fe14f18754a874cd9af9861920b54ec6165e877f4ccc26aef602cc4f8c3'},
 'zachary-night-everyone-belonged:en':{size:26211896,sha256:'b59c89989980ff05ecbbf4804e5f91979368c030e0910871c2e02f7bddb77b0c'},
 'zachary-night-everyone-belonged:es':{size:28262783,sha256:'78f58ed50c6152e7602198704a7be7618bc777b1aa30f46a725058a33abe787d'},
 'zachary-night-everyone-belonged:fr':{size:28259028,sha256:'6f4c210fa5bb5844ebc8f9536e32da3cebcfe33a4a3ca1c0cab474fc2f1f4449'},
 'zachary-night-everyone-belonged:de':{size:28265758,sha256:'745e5df235cad372802762fb51bd0570b7fd6a987e984e84fc744411658ec91b'},
 'zachary-night-everyone-belonged:pt-PT':{size:28261193,sha256:'dafa85452ae7aba8e2f1130242308c2703191124ad598e9927681ce2ee84be22'},
 'zachary-night-everyone-belonged:tr':{size:28262407,sha256:'918f557d7cf6f750ebc3668853c18aac08ef4e8e460fc8168156868ed1bc5163'},
 'emir-boy-who-never-smiles:pt-PT':{size:16577364,sha256:'7efc9a748296c06bb243ef67302f4b957eedbc37e0faaab94786a28b2c0494ab'},
 'emir-barbershop-boys-and-salon-girls:pt-PT':{size:16575707,sha256:'bba681560b988ee298b0b519491c4445c6a6f6296f38c16120d98e892df1900c'},
 'emir-meets-zachary:pt-PT':{size:12795275,sha256:'908265b616e6fe3eeeb6fb64527f6ac5c23089a309355b7ec7e63ab77fb08be2'}
};
const chunkSize=524288,maxBody=4*1048576;
const pending=new Map();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};

async function stored(pool,slug,lang,want){
 const row=(await pool.query('SELECT size,sha256,approved_at FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang])).rows[0];
 return Boolean(row?.approved_at&&row.sha256===want.sha256&&Number(row.size)===want.size);
}
async function save(pool,slug,lang,pdf,want){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Explicit owner replacement: any earlier private edition of this title and
  // language is removed; published release/bundle records are left untouched.
  await client.query('DELETE FROM aom_storybook_files WHERE slug=$1 AND language=$2',[slug,lang]);
  await client.query('INSERT INTO aom_storybook_files(slug,language,size,sha256) VALUES($1,$2,$3,$4)',[slug,lang,want.size,want.sha256]);
  for(let offset=0;offset<pdf.length;offset+=chunkSize)
   await client.query('INSERT INTO aom_storybook_pdf_parts(slug,language,part,bytes) VALUES($1,$2,$3,$4)',[slug,lang,offset/chunkSize,pdf.subarray(offset,offset+chunkSize)]);
  const rows=(await client.query('SELECT bytes FROM aom_storybook_pdf_parts WHERE slug=$1 AND language=$2 ORDER BY part',[slug,lang])).rows;
  if(digest(Buffer.concat(rows.map(r=>r.bytes)))!==want.sha256)throw Error('Stored edition checksum mismatch');
  await client.query('UPDATE aom_storybook_files SET approved_at=now() WHERE slug=$1 AND language=$2',[slug,lang]);
  await client.query('COMMIT');
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
 finally{client.release()}
}
export async function handleApprovedIntake({req,res,url,pool}){
 if(url.pathname!=='/api/storybook/approved-intake')return false;
 if(!pool){json(res,503,{error:'database unavailable'});return true;}
 const slug=url.searchParams.get('slug'),lang=url.searchParams.get('language');
 const id=slug+':'+lang,want=approved[id];
 if(req.method==='GET'){
  const status={};
  for(const [key,item] of Object.entries(approved)){const [s,l]=key.split(':');status[key]=await stored(pool,s,l,item);}
  json(res,200,status);return true;
 }
 if(req.method!=='POST'||!want){json(res,404,{error:'not an approved edition'});return true;}
 if(await stored(pool,slug,lang,want)){json(res,200,{stored:true,already:true});return true;}
 const offset=Number(url.searchParams.get('offset'));
 const parts=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>maxBody){json(res,413,{error:'chunk too large'});return true;}parts.push(chunk);}
 const body=Buffer.concat(parts);
 let buffer=offset===0?Buffer.alloc(0):pending.get(id);
 if(!buffer||offset!==buffer.length||!body.length||offset+body.length>want.size){pending.delete(id);json(res,409,{error:'unexpected offset',expected:buffer?.length??0});return true;}
 buffer=Buffer.concat([buffer,body]);
 if(buffer.length<want.size){pending.set(id,buffer);json(res,202,{received:buffer.length});return true;}
 pending.delete(id);
 if(digest(buffer)!==want.sha256||buffer.subarray(0,5).toString('latin1')!=='%PDF-'){json(res,422,{error:'checksum mismatch'});return true;}
 await save(pool,slug,lang,buffer,want);
 console.log('Approved edition stored:',JSON.stringify({slug,language:lang,size:want.size,sha256:want.sha256}));
 refreshGiftLibrary(pool);
 json(res,201,{stored:true,size:want.size,sha256:want.sha256});return true;
}
