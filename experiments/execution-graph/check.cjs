// SPDX-License-Identifier: MIT
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { auditExecutions } = require('./audit-bundle.cjs');
const { auditBoundary } = require('../lineage-boundary/audit-executions.cjs');
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const recorded = read('observed-results.json');

function projection(execution) {
  return Object.fromEntries(Object.entries(execution.data.resultData.runData)
    .filter(([node]) => node !== 'Webhook')
    .map(([node, runs]) => [node, runs.map(task => task.data.main.map(output =>
      (output ?? []).map(item => item.json)))]));
}

const projections = [];
for (const selection of [1, 2]) {
  const bundle = ['parent', 'bridge', 'leaf'].map(role =>
    read(`recorded/nested-input${selection}-${role}-execution.json`));
  const oracle = read(`recorded/nested-input${selection}-oracle.json`);
  const selected = oracle.orders.map((order, i) => ({ order, i }));
  if (selection === 2) selected.sort((a, b) => b.order.sequence - a.order.sequence);
  const expected = selected.slice(0, 2).map(row => row.i);
  assert.deepEqual(expected, oracle.expected_root_order_indices_by_slot);
  const selectNode = bundle[2].workflowData.nodes.find(node => node.name === 'Select');
  assert.equal(selectNode.parameters.useDataOfInput, selection);
  const report = auditExecutions(bundle);
  assert.equal(report.status, selection === 1 ? 'consistent' : 'mismatch');
  assert.equal(report.boundary_count, 2);
  assert.equal(report.checked_items, 4);
  assert.equal(report.mismatches, selection === 1 ? 0 : 4);
  const byChild = r => Object.fromEntries(r.boundaries.map(b => [b.child_execution, b]));
  assert.deepEqual(byChild(auditExecutions([...bundle].reverse())), byChild(report));
  for (const boundary of report.boundaries) {
    assert.deepEqual(boundary.findings.map(row => row.expected.map(c => c.item)), expected.map(i => [i]));
    assert.deepEqual(boundary.findings.map(row => row.roots), expected.map(i => [{
      execution: String(bundle[0].id), node: 'Orders', run: 0, output: 0, item: i,
    }]));
  }
  // A complete pairwise baseline sees the inner fault. Composition additionally
  // corrects the outer input origins and exposes the propagated disagreement.
  assert.equal(auditBoundary(bundle[0], bundle[1]).status, 'consistent');
  assert.equal(auditBoundary(bundle[1], bundle[2]).status, selection === 1 ? 'consistent' : 'mismatch');
  assert.equal(auditExecutions(bundle.slice(0, 2)).status, 'incomplete');
  assert.equal(auditExecutions([bundle[0], bundle[0]]).status, 'incomplete');
  for (const execution of bundle) {
    assert.equal('resumeToken' in execution.data, false);
    const webhooks = execution.data.resultData.runData.Webhook ?? [];
    for (const task of webhooks) for (const items of task.data.main)
      for (const item of items ?? []) assert.equal('headers' in item.json, false);
  }
  const measured = recorded.cases.find(row => row.case === `nested-input${selection}`);
  assert.deepEqual(measured.execution_statuses, { parent: 'success', bridge: 'success', leaf: 'success' });
  assert.deepEqual(measured.oracle.expected_recipients_by_slot, selected.slice(0, 2).map(row => row.order.id));
  assert.deepEqual(measured.actual_recipients_by_slot, ['customer-A', 'customer-B']);
  assert.equal(measured.identity_passed, selection === 1);
  projections.push(bundle.map(projection));
}
assert.deepEqual(projections[0], projections[1]);
assert.equal(recorded.business_node_count, 14);
assert.equal(recorded.json_only_equal, true);
assert.equal(recorded.native_fault_injection, false);
assert.deepEqual(recorded.cleanup, { container_released: true, database_released: true });

const eachBundle = ['parent', 'child-0', 'child-1', 'child-2'].map(role =>
  read(`recorded/each-allruns/${role}-execution.json`));
const eachOracle = read('recorded/each-allruns/oracle.json');
const eachReport = auditExecutions(eachBundle);
assert.equal(eachReport.status, 'consistent');
assert.equal(eachReport.boundary_count, 3);
assert.equal(eachReport.checked_items, 9);
assert.equal(eachReport.mismatches, 0);
const returned = eachReport.boundaries.flatMap(b => b.findings).sort((a, b) => a.caller.item - b.caller.item);
for (const [slot, finding] of returned.entries()) {
  const expected = eachOracle.expected_by_slot[slot];
  const root = { execution: String(eachBundle[0].id), node: 'Orders', run: 0, output: 0,
    item: expected.caller_input_index };
  assert.deepEqual(finding.expected, [root]);
  assert.deepEqual(finding.observed, [root]);
  assert.deepEqual(finding.roots, [root]);
  assert.equal(finding.terminal.run, expected.child_terminal.run);
  assert.equal(finding.terminal.item, expected.child_terminal.item);
}
for (const child of eachBundle.slice(1)) assert.throws(() => auditBoundary(eachBundle[0], child));
assert.deepEqual(recorded.each_allruns.cleanup, { container_released: true, database_released: true });
console.log('PASS: native nested control/fault + each/allRuns, independent oracles, composed roots, pairwise baseline, missing child, public exports');
