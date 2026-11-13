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
