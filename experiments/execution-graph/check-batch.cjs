// SPDX-License-Identifier: MIT
'use strict';
// A runnable business-grain source contract: these five Orders items are the
// original business records. Call inlet slots are local to each loop batch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ExecutionGraph, coord, key } = require('./audit-bundle.cjs');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'recorded/batch', name), 'utf8'));
const bundle = ['parent', 'child-0', 'child-1', 'child-2'].map(role => read(`${role}-execution.json`));
const parent = bundle[0];
const oracle = read('oracle.json');
const graph = new ExecutionGraph(bundle);
const report = graph.audit();
assert.equal(report.status, 'consistent');
assert.equal(report.boundary_count, 3);
assert.equal(report.checked_items, 5);
const sources = parent.data.resultData.runData.Orders[0].data.main[0]
  .map((_, item) => coord(parent.id, 'Orders', 0, 0, item));
assert.equal(sources.length, oracle.orders.length);
const stopAt = new Set(sources.map(key));
for (const boundary of report.boundaries) {
  const expected = oracle.expected_call_runs[boundary.run];
  assert.deepEqual(boundary.findings.map(f => graph.trace(f.caller, stopAt)),
    expected.global_orders_indices.map(i => [sources[i]]));
}
const aggregate = coord(parent.id, 'Aggregate', 0, 0, 0);
const roots = graph.trace(aggregate, stopAt);
assert.deepEqual(roots, sources);
assert.equal(roots.length, 5);
console.log(JSON.stringify({ status: report.status, checked_items: report.checked_items,
  source_contract: 'Original Orders output, preserving all five business records',
  aggregate, roots }, null, 2));
