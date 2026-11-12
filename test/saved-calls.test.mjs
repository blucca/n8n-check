import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { auditExecutions } from '../web/saved-calls/core.mjs';

const bundle = selection => ['parent', 'bridge', 'leaf'].map(role => JSON.parse(readFileSync(
  new URL(`../experiments/execution-graph/recorded/nested-input${selection}-${role}-execution.json`, import.meta.url))));

test('browser/CLI JSON core retains native nested results, root slots and missing-child state', () => {
  for (const selection of [1, 2]) {
    const executions = bundle(selection);
    const report = auditExecutions(executions);
    assert.equal(report.status, selection === 1 ? 'consistent' : 'mismatch');
    assert.equal(report.checked_items, 4);
    assert.equal(report.mismatches, selection === 1 ? 0 : 4);
    const slots = selection === 1 ? [0, 1] : [3, 2];
    for (const boundary of report.boundaries)
      assert.deepEqual(boundary.findings.map(f => f.roots.map(c => c.item)), slots.map(i => [i]));
    // Parsed JSON can have a different object-field order at each saved end.
    const reordered = structuredClone(executions);
    for (const task of Object.values(reordered[2].data.resultData.runData).flat())
      for (const items of task.data.main)
        for (const item of items ?? []) item.json = Object.fromEntries(Object.entries(item.json).reverse());
    assert.deepEqual(auditExecutions(reordered), report);
    assert.equal(auditExecutions(executions.slice(0, 2)).status, 'incomplete');
  }
});
