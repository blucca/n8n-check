// Minimal checks for the changed traversal; real runtime receipts remain primary.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { findPairedItemThroughWorkflowData: trace } = require('./backtracking.cjs');
const files = process.argv.slice(2);
assert.equal(files.length, 2, 'Pass input1 and input2 raw child execution JSON files');
for (const [index, file] of files.entries()) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')).data;
  const last = data.resultData.runData[data.resultData.lastNodeExecuted].at(-1);
  const result = last.data.main[0].map((item, i) => trace(data, item, i));
  assert.deepEqual(result, (index === 0 ? [0, 1] : [3, 2]).map(item => ({ item })));
}
// Legal fan-in, producer output 1 and an explicit second producer run.
const source = { source: [], data: { main: [[{ json: {}, pairedItem: 3 }, { json: {}, pairedItem: 1 }]] } };
const fork = { source: [{ previousNode: 'Start' }], data: { main: [[], [{ json: {}, pairedItem: 0 }]] } };
const data = { resultData: { lastNodeExecuted: 'Join', runData: {
  Start: [source], Fork: [{ source: [], data: { main: [[]] } }, fork],
  Join: [{ source: [{ previousNode: 'Fork', previousNodeRun: 1, previousNodeOutput: 1 },
                     { previousNode: 'Start' }], data: { main: [[]] } }],
} } };
assert.deepEqual(trace(data, { pairedItem: [{ item: 0 }, { item: 1, input: 1 }] }, 0), [{ item: 3 }, { item: 1 }]);
assert.equal(trace(data, { pairedItem: { item: 0, input: 8 } }, 0), undefined);
console.log('Real branch receipts and fan-in/output/run traversal checks passed.');
