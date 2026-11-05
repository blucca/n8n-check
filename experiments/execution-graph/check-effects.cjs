#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { auditEffects } = require('./effect-contract.cjs');
const directory = path.join(__dirname, 'recorded/effects');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const oracle = read('oracle.json');
const native = [];
const snapshots = {};
for (const label of ['saved-json', 'http-first']) {
  const bundle = [read(`${label}-parent-execution.json`), read(`${label}-child-execution.json`)];
  const contract = read(`${label}-contract.json`);
  const http = read(`${label}-http-observations.json`);
  const report = auditEffects(bundle, contract, http);
  const data = bundle[0].data.resultData.runData;
  const saved = data['Call Delivery'][0].data.main[0].map(row => row.json);
  const orders = new Map(data.Orders[0].data.main[0].map(row => [row.json.order.id, row.json.order]));
  const customers = new Map(data.Customers[0].data.main[0].map(row =>
    [JSON.stringify([row.json.customer.tenantId, row.json.customer.id]), row.json.customer]));
  // Strong complete-key baseline checks saved and observed payloads separately.
  const wrong = rows => rows.filter(effect => {
    const order = orders.get(effect.subjectId);
    return effect.recipient !== customers.get(JSON.stringify([order.tenantId, order.customerId])).email;
  }).map(row => row.slot).sort();
  const expectedWrong = label === 'http-first' ? [1, 2, 3] : [];
  assert(bundle.every(row => row.status === 'success'));
  assert.equal(report.source_ancestry.status, 'consistent');
  assert.equal(report.source_ancestry.checked_items, 4);
  assert.equal(report.saved_relationship.status, 'consistent');
  assert.equal(report.saved_relationship.checked_items, 4);
  assert.equal(report.actual_effects.checked_items, 4);
  assert.deepEqual(wrong(saved), []);
  assert.deepEqual(wrong(http.map(row => row.body)), expectedWrong);
  const actualWrong = report.actual_effects.findings.filter(row => row.status === 'mismatch').map(row => row.slot);
  assert.deepEqual(actualWrong, expectedWrong);
  assert.deepEqual(http.filter(row => row.body.recipient !== oracle.expected[row.coordinate.item].recipient)
    .map(row => row.coordinate.item).sort(), expectedWrong);
  for (const [i, finding] of report.actual_effects.findings.entries()) {
    assert.deepEqual(finding.observed, {execution: bundle[0].id, node: 'Deliver', run: 0, output: 0, item: i});
    assert.equal(finding.caller_effect.node, 'Call Delivery');
    assert.equal(finding.caller_effect.item, i);
    assert.equal(finding.subject.item, oracle.expected[i].order_index);
    assert.equal(finding.customer.item, oracle.expected[i].customer_index);
    assert.equal(finding.roots.length, 8);
    assert.equal(finding.order_roots.length, 4);
    assert.equal(finding.customer_roots.length, 4);
    assert.equal(http[i].body.subjectId, oracle.expected[i].subjectId);
    assert.equal(http[i].body.slot, oracle.expected[i].slot);
  }
  assert(!JSON.stringify(report).includes('@example.test'));
  assert(!JSON.stringify(report).includes('order-0'));
  assert.deepEqual(auditEffects(bundle, contract, [...http].reverse()), report);
  snapshots[label] = bundle.map(execution => Object.fromEntries(
    Object.entries(execution.data.resultData.runData).filter(([name]) => name !== 'Webhook')
      .map(([name, runs]) => [name, runs.map(task => task.data.main.map(items => (items || []).map(item => item.json)))])));
  assert.equal(auditEffects(bundle, contract, http.slice(0, -1)).actual_effects.code, 'OBSERVATION_MISSING');
  assert.equal(auditEffects(bundle, contract, [...http, http[0]]).actual_effects.code, 'DUPLICATE_OBSERVATION_COORDINATE');
  const foreign = structuredClone(http);
  foreign[0].coordinate.execution = bundle[1].id;
  assert.equal(auditEffects(bundle, contract, foreign).actual_effects.code, 'OBSERVATION_OUTSIDE_TARGET');
  const wrongSubject = structuredClone(http);
  wrongSubject[0].body.subjectId = oracle.expected[3].subjectId;
  assert(auditEffects(bundle, contract, wrongSubject).actual_effects.findings[0].codes.includes('OBSERVED_SUBJECT_MISMATCH'));
  const wrongSlot = structuredClone(http);
  wrongSlot[0].body.slot = 3;
  assert(auditEffects(bundle, contract, wrongSlot).actual_effects.findings[0].codes.includes('OBSERVED_SLOT_MISMATCH'));
  const wrongBinding = structuredClone(bundle);
  wrongBinding[0].data.resultData.runData.Deliver[0].data.main[0][0].pairedItem = {item: 1};
  assert.equal(auditEffects(wrongBinding, contract, http).actual_effects.code, 'DUPLICATE_CALLER_EFFECT_BINDING');
  assert.equal(auditEffects([bundle[0]], contract, http).status, 'incomplete');
  native.push({label, source_ancestry: report.source_ancestry.status,
    saved_relationship: report.saved_relationship.status, actual_effects: report.actual_effects.status,
    saved_complete_key_baseline_mismatch_slots: wrong(saved),
    actual_complete_key_baseline_mismatch_slots: wrong(http.map(row => row.body)),
    mismatch_slots: actualWrong, checked: 4, roots_per_effect: 8});
}
assert.deepEqual(snapshots['saved-json'], snapshots['http-first']);
assert.equal(snapshots['saved-json'].reduce((count, nodes) => count + Object.keys(nodes).length, 0), 11);
console.log(JSON.stringify({status: 'PASS', business_json_same_axes: true, business_nodes: 11, native,
  synthetic_checks: ['missing observation', 'duplicate observer coordinate', 'foreign execution coordinate',
    'observed subject/slot mismatch', 'duplicate caller binding', 'missing child'],
  other_checks: ['arrival order independent', 'coordinate-only report']}, null, 2));
