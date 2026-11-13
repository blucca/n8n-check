#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { draftCase } from '../src/case-draft.mjs';
import { editorTestWorkflow } from '../src/editor-test.mjs';
import { runCase } from '../src/runner.mjs';
import { version } from '../src/version.mjs';

async function writeNewJson(file, value) {
  try { await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`File already exists: ${file}. Choose a new --out path.`); throw error; }
}

const help = `n8n-check ${version} — real n8n executions, fixture inputs, local HTTP mocks

Usage:
  n8n-check <workflow.json> <case.json> [--out directory] [--n8n binary]
  n8n-check init <workflow.json> [--input NAME] [--assert NAME] [--stop-after NAME] [--out case.json]
  n8n-check editor-test <workflow.json> <case.json> [--out n8n-editor-test.json]

Options:
  --out PATH       Report dir (.n8n-check); init/editor-test JSON file
  --input NAME     init: fixture boundary node (defaults to first suitable pin)
  --assert NAME    init: downstream output node (defaults to reachable terminal)
  --stop-after NAME init: cut this node's outgoing edges; sibling branches remain
  --n8n BINARY     Installed n8n CLI (default N8N_BINARY or n8n)
  --allow-network  Use host networking for a trusted local development run
  --json           Print report JSON to stdout
  --help           Show this help
  --version        Show runner version

Execution default: requires Linux with only the loopback network interface.
init/editor-test: generate local JSON without an n8n runtime.
Docker: docker run --rm --network none -v "$PWD:/work" n8n-check ...
Exit codes: 0 passed or JSON file written; 1 regression/execution failure; 2 setup/configuration error.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, assert: { type: 'string' }, 'stop-after': { type: 'string' }, out: { type: 'string' }, n8n: { type: 'string' }, 'allow-network': { type: 'boolean' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.help) console.log(help);
  else if (values.version) console.log(version);
  else if (positionals[0] === 'init') {
    if (positionals.length !== 2) throw new Error('Supply init workflow.json. Run n8n-check --help for usage.');
    const source = JSON.parse(await readFile(positionals[1], 'utf8'));
    const draft = draftCase(source, { inputNode: values.input, assertNode: values.assert, stopAfter: values['stop-after'] });
    const file = values.out ?? 'case.json';
    await writeNewJson(file, draft.spec);
    console.log(`Wrote ${file} (${draft.ready ? 'ready for a first run' : `${draft.issues.length} fields or slice issues to resolve`}).`);
    console.log(`Input: ${draft.summary.inputNode}; assertion: ${draft.summary.assertNode || '(choose a downstream node)'}`);
    if (draft.spec.stopAfter !== undefined) console.log(`Stop after: ${draft.spec.stopAfter}; independently reachable branches remain in the slice.`);
    for (const issue of draft.issues) console.error(`  ${issue.path}: ${issue.message}`);
    if (draft.ready) console.log('Review the pinned snapshots against the intended behavior, then run this case with your workflow export.');
  }
  else if (positionals[0] === 'editor-test') {
    if (positionals.length !== 3) throw new Error('Supply editor-test workflow.json case.json. Run n8n-check --help for usage.');
    if (Object.keys(values).some(key => key !== 'out')) throw new Error('editor-test only accepts --out. Set fixture, stopAfter and assertions in case.json.');
    const source = JSON.parse(await readFile(positionals[1], 'utf8'));
    const spec = JSON.parse(await readFile(positionals[2], 'utf8'));
    const file = values.out ?? 'n8n-editor-test.json';
    // This command only emits the existing local-JSON bridge; execution stays in n8n.
    await writeNewJson(file, editorTestWorkflow(source, spec));
    console.log(`Wrote ${file}. Import this inactive workflow into n8n, leave the oracle branch last, then Execute workflow.`);
  }
  else {
    if (values.input !== undefined || values.assert !== undefined || values['stop-after'] !== undefined) throw new Error('--input, --assert and --stop-after are init options. Set stopAfter in case.json for execution.');
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
