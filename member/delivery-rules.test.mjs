import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLanguage, isEntitled, approvedEdition, outboxKey } from './delivery-rules.mjs';
const now = new Date('2026-11-13T11:00:00Z');
test('language normalized without inferring location', () => {
  assert.equal(selectLanguage('pt'), 'pt-PT');
  assert.equal(selectLanguage('DE-de'), 'de');
  assert.equal(selectLanguage('en-US'), 'en');
});
test('only paid and unexpired states are entitled', () => {
  assert.equal(isEntitled({status:'active',currentPeriodEnd:'2026-12-01T00:00:00Z'},now),true);
  assert.equal(isEntitled({status:'past_due',currentPeriodEnd:'2026-12-01T00:00:00Z'},now),false);
  assert.equal(isEntitled({status:'active',currentPeriodEnd:'2026-11-01T00:00:00Z'},now),false);
  assert.equal(isEntitled({status:'active'},now),false);
});
test('never substitute another translation', () => {
  const release={status:'published', editions:{en:{approved:true,storageKey:'private/en.pdf'},'pt-PT':{approved:false,storageKey:'private/pt.pdf'}}};
  assert.equal(approvedEdition(release,'de'),null);
  assert.equal(approvedEdition(release,'pt'),null);
  assert.equal(approvedEdition(release,'en')?.storageKey,'private/en.pdf');
});
test('stable deduplication keys',()=>{
  assert.equal(outboxKey('a','b'),outboxKey('a','b'));
  assert.throws(()=>outboxKey('a','b','unknown'));
});

test('March subscriber immediately receives five already-published books from November through March', async () => {
  const { readingCycleStart, releasedBooksInCurrentCycle } = await import('./delivery-rules.mjs');
  const on = new Date('2027-03-15T12:00:00Z');
  assert.equal(readingCycleStart(on).toISOString(),'2026-11-01T00:00:00.000Z');
  const releases = [
    {publishedAt:'2026-10-01T12:00:00Z',status:'published',editions:{en:{approved:true,storageKey:'customer-pdfs/old.pdf'}}},
    ...[11,12,1,2,3,4].map((month,i)=>({
      id:'book-'+(i+1),
      publishedAt:(month>=11?'2026':'2027')+'-'+String(month).padStart(2,'0')+'-05T12:00:00Z',
      status:'published',
      editions:{en:{approved:true,storageKey:'customer-pdfs/'+(i+1)+'-en.pdf'}}
    }))
  ];
  assert.deepEqual(releasedBooksInCurrentCycle(releases,'en',on).map(x=>x.id),
    ['book-1','book-2','book-3','book-4','book-5']);
  assert.equal(releasedBooksInCurrentCycle(releases,'de',on).length,0,'never deliver English book in place of German');
});
test('annual billing anniversary does not reset the November reading cycle', async()=>{
  const {readingCycleStart}=await import('./delivery-rules.mjs');
  assert.equal(readingCycleStart(new Date('2027-03-15')).getUTCFullYear(),2026);
  assert.equal(readingCycleStart(new Date('2027-11-01')).getUTCFullYear(),2027);
});
