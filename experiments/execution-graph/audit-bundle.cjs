// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// Node >=24, as required by n8n-check. The browser and CLI share one JSON core.
const fs = require('node:fs');
const core = require('../../web/saved-calls/core.mjs');
const { auditExecutions } = core;
function evidence(ok, reason) { if (!ok) throw new Error(reason); }
module.exports = core;
if (require.main === module) {
  let report;
  try {
    evidence(process.argv.length >= 4, 'Usage: node audit-bundle.cjs parent.json child.json [nested-child.json ...]');
    report = auditExecutions(process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch (error) { report = { status: 'incomplete', reason: error.message }; }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = { consistent: 0, mismatch: 1, incomplete: 2 }[report.status];
}
