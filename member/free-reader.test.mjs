import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.APP_URL=process.env.APP_URL||'https://example.test';
const {handleBarber}=await import('./barber-gifts.mjs');
const {shelfScript,readerPage}=await import('./free-reader.mjs');
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(1200000,7)]);
const sha=createHash('sha256').update(pdf).digest('hex');
const C=524288,parts=[];for(let i=0;i*C<pdf.length;i++)parts.push(pdf.subarray(i*C,(i+1)*C));
const SLUG='zachary-my-unique-hat-2026-11';
const pool={query:async(sql,p)=>{
 if(sql.includes('UNION'))return {rows:p[0]==='en'?[{slug:SLUG}]:[]};
 if(sql.startsWith('SELECT size,sha256 FROM aom_storybook_files'))return {rows:p[0]===SLUG&&p[1]==='en'?[{size:pdf.length,sha256:sha}]:[]};
 if(sql.startsWith('SELECT bytes FROM aom_storybook_pdf_parts'))return {rows:parts[p[2]]?[{bytes:parts[p[2]]}]:[]};
 return {rows:[]};}};
async function call(path,headers={}){
 const chunks=[];const res={headersSent:false,destroyed:false,status:0,h:{},writeHead(s,h){this.status=s;this.h=h||{};this.headersSent=true;},setHeader(){},write(b){chunks.push(Buffer.from(b));return true;},end(b){if(b)chunks.push(Buffer.from(b));},destroy(){this.destroyed=true}};
 await handleBarber({req:{method:'GET',headers},res,url:new URL('https://x'+path),pool});
 return {s:res.status,h:res.h,b:Buffer.concat(chunks)};
}
const book='/barber/free-book.pdf?slug='+SLUG+'&language=en';
test('free book streams whole, inline, with ranges', async()=>{
 let r=await call(book);assert.equal(r.s,200);assert.ok(r.b.equals(pdf));assert.match(r.h['Content-Disposition'],/^inline/);
 r=await call(book,{range:'bytes=524000-524600'});assert.equal(r.s,206);assert.equal(r.h['Content-Range'],'bytes 524000-524600/'+pdf.length);assert.ok(r.b.equals(pdf.subarray(524000,524601)));
 r=await call(book,{range:'bytes=-100'});assert.equal(r.s,206);assert.ok(r.b.equals(pdf.subarray(pdf.length-100)));
 r=await call(book+'&download=1');assert.match(r.h['Content-Disposition'],/^attachment/);
});
test('only approved editions in gift languages', async()=>{
 assert.equal((await call('/barber/free-book.pdf?slug='+SLUG+'&language=de')).s,404);
 assert.equal((await call('/barber/free-book.pdf?slug=../x&language=en')).s,404);
 assert.equal((await call('/barber/read?slug='+SLUG+'&language=it')).s,404);
});
test('library, reader and shelf', async()=>{
 const lib=JSON.parse((await call('/barber/free-library')).b);
 assert.deepEqual(lib.languages.find(l=>l.language==='en').books.map(b=>[b.slug,b.series,b.number]),[[SLUG,'Zachary',1]]);
 const reader=await call('/barber/read?slug='+SLUG+'&language=en');assert.equal(reader.s,200);assert.ok(reader.b.includes('pdf.min.js'));
 assert.doesNotThrow(()=>new Function(shelfScript));
 const html=readerPage({slug:SLUG,lang:'tr',title:'<b>x</b>',series:'Zachary',number:1});
 assert.ok(!html.includes('<b>x</b>'));assert.doesNotThrow(()=>new Function(html.split('<script>')[1].split('</script>')[0]));
});
