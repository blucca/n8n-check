#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { auditExecutions } = require('./audit-bundle.cjs');
const { auditRelations } = require('./relation-contract.cjs');
const directory = path.join(__dirname, 'recorded/relations');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const oracle = read('oracle.json');
const expectedHttp = oracle.expected.map(({slot, subjectId, recipient}) => ({slot, subjectId, recipient}));
const observations = [];
for (const label of ['full-key', 'single-key']) {
  const bundle = [read(`${label}-parent-execution.json`), read(`${label}-child-execution.json`)];
  const contract = read(`${label}-contract.json`);
  const parentData = bundle[0].data.resultData.runData;
  const effects = parentData['Call Delivery'][0].data.main[0].map(row => row.json);
  const http = read(`${label}-http-observations.json`);
  const ancestry = auditExecutions(bundle);
  assert.equal(ancestry.status, 'consistent');
  assert.equal(ancestry.checked_items, 4);
  assert.deepEqual(http, effects);
  assert.deepEqual(http.map(({slot, subjectId}) => ({slot, subjectId})),
    expectedHttp.map(({slot, subjectId}) => ({slot, subjectId})));
  // Strong baseline: complete business-key join, independent of provenance.
  const orders = new Map(parentData.Orders[0].data.main[0].map(row => [row.json.order.id, row.json.order]));
  const customers = new Map(parentData.Customers[0].data.main[0].map(row =>
    [JSON.stringify([row.json.customer.tenantId, row.json.customer.id]), row.json.customer]));
  const baselineWrong = effects.filter(effect => {
    const order = orders.get(effect.subjectId);
    return effect.recipient !== customers.get(JSON.stringify([order.tenantId, order.customerId])).email;
  }).map(row => row.slot);
  const oracleWrong = http.filter((row, i) => row.recipient !== expectedHttp[i].recipient).map(row => row.slot);
  const report = auditRelations(bundle, contract);
  const reportWrong = report.findings.filter(row => row.status === 'mismatch').map(row => row.slot);
  const expectedWrong = label === 'full-key' ? [] : [2, 3];
  assert.deepEqual(baselineWrong, expectedWrong);
  assert.deepEqual(oracleWrong, expectedWrong);
  assert.deepEqual(reportWrong, expectedWrong);
  assert.deepEqual(report.source_counts, { orders: 4, customers: 4 });
  for (const [i, finding] of report.findings.entries()) {
    assert.equal(finding.roots.length, 8);
    assert.equal(finding.order_roots.length, 4);
    assert.equal(finding.customer_roots.length, 4);
    assert.equal(finding.subject.item, oracle.expected[i].order_index);
    assert.equal(finding.customer.item, oracle.expected[i].customer_index);
    assert.equal(finding.slot, oracle.expected[i].slot);
  }
  assert.equal(auditRelations([bundle[0]], contract).status, 'incomplete');
  const duplicate = structuredClone(bundle);
  duplicate[0].data.resultData.runData.Customers[0].data.main[0][1].json.customer =
    structuredClone(duplicate[0].data.resultData.runData.Customers[0].data.main[0][0].json.customer);
  assert.equal(auditRelations(duplicate, contract).code, 'DUPLICATE_CUSTOMER_KEY');
  // Offline corruption only: keep payloads, drop the recorded customer inlet.
  const noCustomerEvidence = structuredClone(bundle);
  noCustomerEvidence[0].data.resultData.runData['Join Envelope'][0].data.main[0][0].pairedItem = {item: 0, input: 0};
  const missingRoots = auditRelations(noCustomerEvidence, contract);
  assert.equal(missingRoots.status, 'mismatch');
  assert(missingRoots.findings.every(row => row.codes.includes('CUSTOMER_ROOT_MISSING')));
  assert(!JSON.stringify(report).includes('@example.test'));
  observations.push({label, ancestry: ancestry.status, relationship: report.status,
    checked: report.checked_items, mismatch_slots: reportWrong, roots_per_effect: 8,
    strong_complete_key_baseline_mismatch_slots: baselineWrong});
}
console.log(JSON.stringify({status: 'PASS', native: observations,
  extra_checks: ['missing child incomplete', 'duplicate complete key incomplete',
    'synthetic customer inlet removal mismatch', 'coordinate-only default report']}, null, 2));
