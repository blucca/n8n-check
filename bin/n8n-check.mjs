#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runCase } from '../src/runner.mjs';
import { version } from '../src/version.mjs';

const help = `n8n-check ${version} — real n8n executions, fixture inputs, local HTTP mocks

Usage:
  n8n-check <workflow.json> <case.json> [--out directory] [--n8n binary]

Options:
  --out DIRECTORY  JSON, JUnit and execution artifacts (default .n8n-check)
  --n8n BINARY     Installed n8n CLI (default N8N_BINARY or n8n)
  --allow-network  Use host networking for a trusted local development run
  --json           Print report JSON to stdout
  --help           Show this help
  --version        Show runner version

Default: requires Linux with only the loopback network interface.
Docker: docker run --rm --network none -v "$PWD:/work" n8n-check ...
Exit codes: 0 passed; 1 regression/execution failure; 2 setup/configuration error.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, n8n: { type: 'string' }, 'allow-network': { type: 'boolean' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.help) console.log(help);
  else if (values.version) console.log(version);
  else {
    if (positionals.length !== 2) throw new Error('Supply workflow.json and case.json. Run n8n-check --help for usage.');
    const report = await runCase({ workflowFile: positionals[0], caseFile: positionals[1], out: values.out, n8n: values.n8n, allowNetwork: values['allow-network'] });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.status.toUpperCase()} ${report.name}${report.n8nVersion ? ` (n8n ${report.n8nVersion})` : ''}`);
      for (const check of report.checks) console.log(`  ${check.passed ? '✓' : '✗'} ${check.name}${check.passed ? '' : `\n    ${JSON.stringify({ expected: check.expected, actual: check.actual })}`}`);
      if (report.error) console.error(report.error);
      console.log(`Reports: ${report.artifacts}/report.json and junit.xml`);
    }
    process.exitCode = report.exitCode;
  }
} catch (error) { console.error(`n8n-check: ${error.message}`); process.exitCode = 2; }
