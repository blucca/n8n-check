// Minimal check of the published observations; execute the workflows for new native results.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const observed = JSON.parse(await readFile(new URL('observed-results.json', import.meta.url), 'utf8'));
const expected = [
  ['order-A', 'order-B', 'order-C'], ['order-A', 'order-B', 'order-C'], ['order-C', 'order-B', 'order-A'],
  ['order-C', 'order-A', 'order-B'], ['order-B', 'order-A', 'order-C'],
  ['order-C', 'order-A', 'order-B'], ['order-B', 'order-A', 'order-C'],
];
assert.deepEqual(observed.runtimes.map(runtime => runtime.n8nVersion), ['2.41.7', '2.47.7']);
for (const runtime of observed.runtimes) {
  assert.equal(runtime.runs.length, expected.length);
  for (const [index, run] of runtime.runs.entries()) {
    assert.deepEqual(run.ids, expected[index]);
    assert.equal(run.rows.length, 3);
    assert.equal(run.sortNodeSuccess, true);
    assert.equal(run.cliExit, index === 1 || index === 2 ? 1 : 0);
    if (index === 3 || index === 4) {
      assert.equal(run.oracleStatus, 'passed');
      for (const row of run.rows) {
        assert.equal(typeof row.orderTotal, 'string');
        assert.equal(Object.hasOwn(row, '_amountSortKey'), false);
      }
    }
  }
}
console.log('Both recorded runtimes: seven controls, original amount strings and order IDs match.');
