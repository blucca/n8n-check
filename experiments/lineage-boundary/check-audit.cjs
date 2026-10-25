// Small checks against already-recorded native runs; starts no n8n process.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { auditBoundary } = require('./audit-executions.cjs');
const [original, repaired] = process.argv.slice(2);
assert.ok(original && repaired, 'Pass original and repaired --extended output directories');
const read = (dir, name, role) => JSON.parse(fs.readFileSync(path.join(dir, `${name}-${role}-execution.json`)));
const audit = (dir, name) => auditBoundary(read(dir, name, 'parent'), read(dir, name, 'child'));

assert.equal(audit(original, 'input1').status, 'consistent');
const wrong = audit(original, 'input2');
assert.equal(wrong.mismatches, 2);
assert.deepEqual(wrong.findings.map(row => row.expected), [[{ input: 0, item: 3 }], [{ input: 0, item: 2 }]]);
assert.deepEqual(wrong.findings.map(row => row.observed), [[{ input: 0, item: 0 }], [{ input: 0, item: 1 }]]);
assert.equal(audit(original, 'legal-fan-in').mismatches, 1);
for (const name of ['input1', 'input2', 'reduced3-input1', 'reduced3-input2', 'changed-input', 'legal-fan-in']) {
  assert.equal(audit(repaired, name).status, 'consistent', name);
}
assert.throws(() => auditBoundary(read(original, 'input2', 'parent'), read(repaired, 'input2', 'child')),
  /workflow ID differs/, 'Same numeric execution IDs from different instances must not be mixed');
const missing = read(original, 'input2', 'child');
delete missing.data.resultData.runData;
assert.throws(() => auditBoundary(read(original, 'input2', 'parent'), missing), /complete API execution exports/);
console.log('Saved native control, wrong-recipient, fan-in, repaired, and missing/mixed evidence checks passed.');
