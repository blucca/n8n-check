import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root, generateFixtures, scoreEligible, expectedIDs, expectedLeads, contractsFor } from './canaries.mjs';
import { projectRows, domainCheck, relationCheck, verifyManifest } from './run-native.mjs';
import { prepareWorkflow, validateCase } from './core/workflow.mjs';
import { executionChecks } from './core/report.mjs';

const passed = [];
const fixtures = generateFixtures(), contracts = contractsFor(fixtures);
assert.deepEqual(fixtures, generateFixtures());
const allIDs = [...fixtures.score.base, ...fixtures.score.changed, ...fixtures.silent.base].map(row => row.id);
assert.ok(allIDs.every(id => id.startsWith('r664-') && !['row-A', 'row-B', 'wrong-row', 'distractor'].includes(id)));
passed.push('seed-reproducible fresh IDs; no old input fixture');

assert.equal(scoreEligible({ score: 0.699 }), false);
assert.equal(scoreEligible({ score: 0.700 }), true);
assert.equal(scoreEligible({ score: 0.701 }), true);
assert.equal(scoreEligible({ score: '0.700' }), false);
const ids = expectedIDs(fixtures.score.base);
assert.deepEqual(ids, [1, 2, 3, 4].map(i => ({ id: fixtures.score.base[i].id })));
assert.equal(ids[0].id, ids[3].id);
passed.push('independent threshold, eligible multiplicity and input order');

const renamedIDs = expectedIDs(fixtures.score.changed);
const rename = { transformation: 'rename', identityMap: fixtures.score.identityMap };
assert.equal(relationCheck(rename, contracts.score, ids, renamedIDs).status, 'consistent');
assert.equal(domainCheck(fixtures.score.base, ids, contracts.score).passed, true);
const ineligibleID = fixtures.score.base[0].id;
assert.equal(domainCheck(fixtures.score.base, [{ id: ineligibleID }], contracts.score).passed, true);
assert.notDeepEqual([{ id: ineligibleID }], ids);
passed.push('all-input membership is weaker than independent eligibility anchor');

const outside = ids.map(() => ({ id: 'wrong-row' }));
const outsideChanged = renamedIDs.map(() => ({ id: 'wrong-row' }));
assert.equal(domainCheck(fixtures.score.base, outside, contracts.score).passed, false);
assert.equal(domainCheck(fixtures.score.changed, outsideChanged, contracts.score).passed, false);
assert.equal(relationCheck(rename, contracts.score, outside, outsideChanged).status, 'consistent');
passed.push('outside literal: membership catches it, rename alone is consistent');

const insideLiteral = fixtures.score.base[1].id;
const inside = ids.map(() => ({ id: insideLiteral }));
const insideChanged = renamedIDs.map(() => ({ id: insideLiteral }));
const insideDomain = domainCheck(fixtures.score.base, inside, contracts.score);
assert.equal(insideDomain.passed, true);
assert.equal(insideDomain.occurrenceOverdrawDiagnostic.length, 1);
assert.equal(domainCheck(fixtures.score.changed, insideChanged, contracts.score).passed, false);
assert.equal(relationCheck(rename, contracts.score, inside, insideChanged).status, 'inconsistent');
assert.equal(inside.length, ids.length); assert.notDeepEqual(inside, ids);
passed.push('inside literal: range, occurrence overdraw, ordered anchor and rename separated');

assert.equal(domainCheck(fixtures.score.base, [], contracts.score).passed, true);
assert.equal(relationCheck(rename, contracts.score, [], []).status, 'consistent');
const fakeExecution = (node, rows) => ({ data: { resultData: { runData: {
  [node]: [{ data: { main: [rows.map(json => ({ json }))] } }],
} } } });
const idAssertions = [{ node: 'Select rows', count: ids.length, pluck: 'json.id', equals: ids.map(row => row.id) }];
const emptyChecks = executionChecks(fakeExecution('Select rows', []), { exitCode: 0 }, idAssertions);
assert.equal(emptyChecks[0].passed, true); assert.ok(emptyChecks.slice(1).every(check => !check.passed));
passed.push('always empty: rename and membership consistent; positive count/identity anchor fails');

const firstBroadcast = ids.map(() => ({ id: ids[0].id }));
const renamedFirstBroadcast = renamedIDs.map(() => ({ id: renamedIDs[0].id }));
assert.equal(relationCheck(rename, contracts.score, firstBroadcast, renamedFirstBroadcast).status, 'consistent');
assert.notDeepEqual(firstBroadcast, ids);
passed.push('first-ID broadcast can covary; independent anchor or old partition method owns detection');

const silentBase = expectedIDs(fixtures.silent.base), silentChanged = expectedIDs(fixtures.silent.changed);
const noise = { transformation: 'source-noise', identityMap: {} };
const echoBase = silentBase.map(row => ({ ...row, source: 'current-index', processedAt: '2026-01-01T00:00:00Z', marker: 'base' }));
const echoChanged = silentChanged.map(row => ({ ...row, source: 'legacy-index', processedAt: '2026-02-01T00:00:00Z', marker: 'changed' }));
assert.ok(!isDeepStrictEqual(echoBase, echoChanged));
assert.equal(relationCheck(noise, contracts.silent, echoBase, echoChanged).status, 'consistent');
assert.equal(relationCheck(noise, contracts.silent, [], silentChanged).status, 'inconsistent');
assert.deepEqual(projectRows(echoBase, ['id']), silentBase);
assert.throws(() => projectRows([{}], ['id']), /missing declared field/);
assert.equal(domainCheck(fixtures.silent.base, [{}], contracts.silent).passed, false);
passed.push('diagnostic echo and dynamic timestamp excluded; required field absence fails');

assert.equal(relationCheck(rename, contracts.whitelist, [], []).status, 'scope_required');
assert.equal(expectedIDs(fixtures.score.base, contracts.whitelist).length, 2);
assert.deepEqual(expectedIDs(fixtures.score.changed, contracts.whitelist), []);
assert.equal(relationCheck(noise, contracts.currentOnly, [], []).status, 'scope_required');
assert.equal(expectedIDs(fixtures.silent.base, contracts.currentOnly).length, 4);
assert.deepEqual(expectedIDs(fixtures.silent.changed, contracts.currentOnly), []);
passed.push('literal whitelist and true current-only business semantics close their respective scopes');

const mailbox = row => row.Email.toLowerCase().replace(/\+[^@]*@/, '@');
assert.equal(fixtures.holdout.base.length, 6);
for (const side of ['base', 'changed']) {
  const rows = fixtures.holdout[side];
  assert.ok(rows.every(row => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(row['Full Name']) && !row['Full Name'].includes('Anna')));
  assert.ok(rows.every(row => /^[a-z0-9]+\+(first|repeat)@canary\.example\.org$/i.test(row.Email)));
  const expected = expectedLeads(rows);
  assert.equal(expected.length, 4);
  assert.deepEqual(expected.map(row => row.full_name), [0, 1, 3, 4].map(i => rows[i]['Full Name']));
  assert.deepEqual(expected.map(row => row.email), [0, 1, 3, 4].map(i => rows[i].Email.toLowerCase()));
  assert.equal(domainCheck(rows, expected, contracts.holdout).passed, true);
}
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  assert.equal(mailbox(fixtures.holdout.base[i]) === mailbox(fixtures.holdout.base[j]), mailbox(fixtures.holdout.changed[i]) === mailbox(fixtures.holdout.changed[j]));
}
assert.equal(new Set(Object.values(fixtures.holdout.identityMap)).size, Object.keys(fixtures.holdout.identityMap).length);
assert.equal(relationCheck({ transformation: 'rename', identityMap: fixtures.holdout.identityMap }, contracts.holdout,
  expectedLeads(fixtures.holdout.base), expectedLeads(fixtures.holdout.changed)).status, 'consistent');
passed.push('valid alias bijection preserves every mailbox class, first row and output order');

await verifyManifest();
const plan = JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'));
assert.equal(plan.plannedExecutions, 20); assert.equal(plan.runs.length, 20); assert.equal(plan.groups.length, 10);
assert.deepEqual(JSON.parse(await readFile(join(root, 'contracts.json'), 'utf8')), contracts);
for (const run of plan.runs) {
  const spec = validateCase(JSON.parse(await readFile(join(root, run.caseFile), 'utf8')));
  const source = JSON.parse(await readFile(join(root, run.workflowFile), 'utf8'));
  const items = JSON.parse(await readFile(join(root, run.businessInputFile), 'utf8'));
  const contract = contracts[run.contractKey];
  assert.deepEqual(run.expectedProjection, contract.family === 'leads' ? expectedLeads(items) : expectedIDs(items, contract));
  const prepared = prepareWorkflow(source, spec, 'http://127.0.0.1:1');
  assert.equal(prepared.workflow.active, false); assert.ok(!Object.hasOwn(prepared.workflow, 'pinData'));
  assert.ok(!prepared.workflow.nodes.some(node => node.type === 'n8n-nodes-base.httpRequest'));
  if (contract.family === 'leads') {
    assert.equal(spec.stopAfter, undefined);
    assert.equal(source.nodes.filter(node => node.type !== 'n8n-nodes-base.stickyNote').length, 17);
    assert.equal(prepared.workflow.nodes.length, 18); // 17 retained functional nodes plus helper trigger.
    assert.equal(prepared.omittedNodes.length, 4);
    assert.equal(source.nodes.find(node => node.name === 'Cleaner settings').parameters.assignments.assignments.find(field => field.name === 'source').value, 'sample');
  } else {
    assert.equal(spec.stopAfter, run.output);
    assert.equal(prepared.workflow.nodes.length, 3);
  }
}
passed.push('twenty frozen native cases validate and prepare; whole sample graph retained, no native executed');

const report = { status: 'passed', checkGroups: passed.length, passed, plannedNativeExecutions: 20, nativeExecutions: 0,
  sourceOrObservedCodeExecuted: false, networkRequests: 0, note: 'Pure assertions and existing case preparation only; no source Code node was executed.' };
await writeFile(join(root, 'pure-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
