'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const commit = '2298c0aefd72de1d5fbb235cd16d64543fafd16a';
const base = `https://raw.githubusercontent.com/jamesshannon/n8n-workflow-testing/${commit}/workflow-testing/docs/reference/invoice-deal-sync/`;
const files = [
  'invoice-deal-sync.workflow.json', 'invoice-deal-sync.n8n-test.yaml',
  'mocks/hubspot-company-globex.json', 'mocks/hubspot-company-acme.json',
  'mocks/hubspot-company-none.json', 'mocks/hubspot-company-hooli.json',
  'mocks/invoices-single-page.json', 'mocks/invoices-page-1.json', 'mocks/invoices-page-2.json',
];
(async () => {
  const output = process.argv[2];
  const manifest = { repository: 'jamesshannon/n8n-workflow-testing', commit, files: {} };
  for (const file of files) {
    const response = await fetch(base + file, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const target = path.join(output, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    manifest.files[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  // Keep the original file. Put the single-field regression in a separate copy.
  const workflow = JSON.parse(await fs.readFile(path.join(output, files[0]), 'utf8'));
  const node = workflow.nodes.find((entry) => entry.name === 'Build Deal Update');
  const amount = node.parameters.assignments.assignments.find((entry) => entry.name === 'amount');
  amount.value = amount.value.replace('$json.amount_due', '$json.amountDue');
  await fs.writeFile(path.join(output, 'wrong-amount.workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Fetched ${files.length} reference files at ${commit}.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
