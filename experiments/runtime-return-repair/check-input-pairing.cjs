// SPDX-License-Identifier: MIT
// Focused source/input/output/run checks. Native exports remain read-only.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveInputPairing: trace } = require('./input-pairing.cjs');
const recorded = path.resolve(__dirname, '../execution-graph/recorded');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const native = file => read(path.join(recorded, file));
const coordinate = (node, run, output, item) => ({ node, run, output, item });
const report = { status: 'pass', native: {}, standalone: {} };

const leaf = native('nested-input2-leaf-execution.json');
const leafOracle = native('nested-input2-oracle.json');
const terminal = leaf.data.resultData.lastNodeExecuted;
const terminalRun = leaf.data.resultData.runData[terminal].length - 1;
const nested = leaf.data.resultData.runData[terminal][terminalRun].data.main[0]
  .map((_, item) => trace(leaf.data, coordinate(terminal, terminalRun, 0, item)));
assert.deepEqual(nested, leafOracle.expected_root_order_indices_by_slot.map(item => ({ item })));
assert.deepEqual(nested, [{ item: 3 }, { item: 2 }]);
report.native.nested_input2 = nested;

// The existing native legal fan-in child starts with four distinct workflow inputs.
const fanInPath = path.join(__dirname, 'recorded/fan-in-child.json');
const fanIn = read(fanInPath);
const fanTerminal = fanIn.data.resultData.lastNodeExecuted;
const fanRoots = trace(fanIn.data,
  coordinate(fanTerminal, fanIn.data.resultData.runData[fanTerminal].length - 1, 0, 0));
assert(Array.isArray(fanRoots));
assert.deepEqual(fanRoots.map(pair => pair.item).sort((a, b) => a - b), [0, 1, 2, 3]);
report.native.legal_fan_in = fanRoots;

const eachOracle = native('each-allruns/oracle.json');
const each = [];
for (const callerInput of [0, 1, 2]) {
  const child = native(`each-allruns/child-${callerInput}-execution.json`);
  const root = child.data.resultData.runData.Start[0].data.main[0][0];
  assert.equal(root.index, callerInput);
  assert.deepEqual(root.pairedItem, { item: 0 });
  const last = child.data.resultData.lastNodeExecuted;
  const items = [];
  for (const [run, task] of child.data.resultData.runData[last].entries()) {
    for (const [output, values] of task.data.main.entries()) {
      for (const [item] of (values ?? []).entries()) {
        const start = coordinate(last, run, output, item);
        const pairing = trace(child.data, start);
        assert.deepEqual(pairing, { item: 0 });
        items.push({ start, pairing });
      }
    }
  }
  const expectedCount = eachOracle.expected_by_slot.filter(row =>
    row.caller_input_index === callerInput).length;
  assert.equal(items.length, expectedCount);
  each.push({ caller_input_index: root.index, child_local_pairing: { item: 0 }, items });
}
assert.equal(each.reduce((sum, child) => sum + child.items.length, 0), 9);
report.native.each_all_runs = each;

const batch = [];
for (const childIndex of [0, 1, 2]) {
  const child = native(`batch/child-${childIndex}-execution.json`);
  const last = child.data.resultData.lastNodeExecuted;
  const inputs = child.data.resultData.runData.Start[0].data.main[0];
  const pairing = child.data.resultData.runData[last][0].data.main[0]
    .map((_, item) => trace(child.data, coordinate(last, 0, 0, item)));
  assert.deepEqual(pairing, inputs.map((_, item) => ({ item })));
  batch.push({ child: childIndex, pairing });
}
const batchParent = native('batch/parent-execution.json');
const aggregate = trace(batchParent.data, coordinate('Aggregate', 0, 0, 0));
assert.deepEqual(aggregate, { item: 0 });
report.native.batch = { children: batch, aggregate_input_pairing: aggregate,
  input_contract: 'The parent input is one Webhook transport item; five Orders roots use a separate business cut.' };

// Reuse the old tiny fan-in fixture, now placing the start item at its actual coordinate.
const start = { source: [], data: { main: [[
  { json: {}, pairedItem: 3 }, { json: {}, pairedItem: 1 },
]] } };
const fork = { source: [{ previousNode: 'Start' }],
  data: { main: [[], [{ json: {}, pairedItem: 0 }]] } };
const source = { previousNode: 'Fork', previousNodeRun: 1, previousNodeOutput: 1 };
const tiny = { resultData: { runData: {
  Start: [start], Fork: [{ source: [], data: { main: [[]] } }, fork],
  Join: [{ source: [source, { previousNode: 'Start' }], data: { main: [[
    { json: {}, pairedItem: [{ item: 0 }, { item: 1, input: 1 }] },
    { json: {}, pairedItem: { item: 0, input: 1, sourceOverwrite: source } },
    { json: {}, pairedItem: { item: 0, input: 8 } },
  ]] } }],
} } };
assert.deepEqual(trace(tiny, coordinate('Join', 0, 0, 0)), [{ item: 3 }, { item: 1 }]);
assert.deepEqual(trace(tiny, coordinate('Join', 0, 0, 1)), { item: 3 });
assert.equal(trace(tiny, coordinate('Join', 0, 0, 2)), undefined);
report.standalone = { origin: 'Existing check-backtracking tiny structure',
  producer_output1_run1: [{ item: 3 }, { item: 1 }], source_overwrite: { item: 3 },
  missing_source: 'undefined' };
console.log(JSON.stringify(report, null, 2));
