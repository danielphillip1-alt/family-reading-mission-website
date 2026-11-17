import test from 'node:test';
import assert from 'node:assert/strict';
process.env.APP_URL='https://example.test';
const {handleApprovedIntake}=await import('./approved-intake.mjs');
function fixture(){
 const writes=[];
 const pool={query:async sql=>{if(sql.includes('FROM aom_storybook_files'))return {rows:[]};throw Error('unexpected '+sql)},
  connect:async()=>{writes.push('connect');throw Error('must not write')}};
 return {pool,writes};
}
async function call(f,method,path,body){
 const res={status:0,body:'',writeHead(s){this.status=s},end(b){this.body=b}};
 const req={method,async *[Symbol.asyncIterator](){if(body)yield body}};
 await handleApprovedIntake({req,res,url:new URL('https://example.test'+path),pool:f.pool});
 return {status:res.status,json:JSON.parse(res.body)};
}
test('only the exact approved editions can be uploaded',async()=>{
 const f=fixture();
 assert.equal((await call(f,'POST','/api/storybook/approved-intake?slug=emir-meets-zachary&language=fr&offset=0',Buffer.from('%PDF-'))).status,404);
 assert.equal((await call(f,'POST','/api/storybook/approved-intake?slug=zachary-my-unique-hat-2026-11&language=en&offset=5',Buffer.from('x'))).status,409);
});
test('a file with the right size but different bytes is rejected without touching the database',async()=>{
 const f=fixture();const fake=Buffer.alloc(12394782,1);let offset=0,last;
 while(offset<fake.length){const part=fake.subarray(offset,offset+4*1048576);
  last=await call(f,'POST','/api/storybook/approved-intake?slug=zachary-my-unique-hat-2026-11&language=pt-PT&offset='+offset,part);offset+=part.length;}
 assert.equal(last.status,422);
 assert.deepEqual(f.writes,[]);
});
