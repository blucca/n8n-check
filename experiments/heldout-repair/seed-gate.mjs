// Development seeds: new inputs relative to reported triggers, authored with gold access.
// Run with Node 24+ in a loopback-only namespace; generated files belong in a temp directory.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { runCase, runtimeEnv, command, checkNetwork } from '../../src/runner.mjs';
import { prepareWorkflow } from '../../src/workflow.mjs';
import { executionFrom, executionChecks } from '../../src/report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2]) throw Error('Usage: node seed-gate.mjs /absolute/temp/output');
const out = resolve(process.argv[2]);
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const eq = (name, actual, expected) => ({ name, passed: isDeepStrictEqual(actual, expected), actual, expected });
const results = [];
const itemsAt = (execution, name) => (execution?.data?.resultData?.runData?.[name] ?? []).flatMap(run => run.data?.main?.[0] ?? []).map(item => item.json);
const network = await checkNetwork(false);

async function record(name, report, extra = []) {
  if (report.status === 'error') throw Error(`${name}: ${report.error}`);
  const checks = [...report.checks, ...extra];
  const row = { name, passed: checks.every(check => check.passed), enginePassed: checks.find(check => check.name === 'n8n execution succeeds')?.passed,
    checks, runDirectory: report.runDirectory, requests: report.requests ?? [] };
  await save(join(out, 'results', name, 'oracle.json'), row);
  results.push({ name, passed: row.passed, enginePassed: row.enginePassed, failed: checks.filter(check => !check.passed).map(check => check.name) });
  await save(join(out, 'summary.json'), { createdAt: new Date().toISOString(), runtime: 'n8n 2.41.7', network, developmentOnly: true, results });
  console.log(JSON.stringify(results.at(-1)));
}

async function standard(name, workflow, spec, n8n = 'n8n') {
  const workflowFile = join(out, 'frozen', name + '.workflow.json');
  const caseFile = join(out, 'frozen', name + '.case.json');
  await save(workflowFile, workflow); await save(caseFile, spec);
  return runCase({ workflowFile, caseFile, n8n, out: join(out, 'results', name) });
}

// The external service is identical for every arm; only the workflow's key expression changes.
async function external(name, workflow, spec, baseUrl) {
  const dir = join(out, 'results', name);
  const home = join(dir, 'n8n-home');
  await mkdir(join(home, 'tmp'), { recursive: true });
  const env = runtimeEnv(home);
  const prepared = prepareWorkflow(workflow, spec, baseUrl);
  const path = join(dir, 'workflow.json');
  await save(path, prepared.workflow);
  const imported = await command('n8n', ['import:workflow', '--input=' + path], env);
  await writeFile(join(dir, 'import.log'), imported.stdout + imported.stderr);
  if (imported.exitCode !== 0 || imported.error) throw Error('Import failed: ' + name + ': ' + (imported.error ?? imported.stderr));
  const raw = await command('n8n', ['execute', '--id=' + prepared.workflow.id, '--rawOutput'], env, 60000);
  await writeFile(join(dir, 'execute.stdout.log'), raw.stdout);
  await writeFile(join(dir, 'execute.stderr.log'), raw.stderr);
  const execution = executionFrom(raw.stdout + '\n' + raw.stderr);
  await save(join(dir, 'execution.json'), execution);
  return { status: 'executed', checks: executionChecks(execution, raw, spec.assertions), runDirectory: dir };
}

const serve = async handler => {
  const server = http.createServer(handler);
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(yes => { server.close(yes); server.closeAllConnections(); }) };
};

// Freeze all visible inputs, added inputs, candidate repairs and references before execution.
const morsof = join(out, 'morsof');
const invoiceCandidate = await read(join(morsof, 'fixed.workflow.json'));
const invoiceOriginal = await read(join(morsof, 'broken.workflow.json'));
const visibleInvoice = await read(join(morsof, 'two-eligible.case.json'));
const invoiceReference = structuredClone(invoiceCandidate);
invoiceReference.nodes.find(node => node.name === 'Group Batch Reminder Keys').parameters.jsCode = `
const items = $input.all();
const signatures = new Map();
for (const {json: v} of items) {
  if (v.outputPath !== 'ready_for_review') continue;
  const key = JSON.stringify([v.invoiceId, v.reminderStage]);
  const signature = JSON.stringify([v.customerId, v.email, v.currency, v.totalAmount, v.paidAmount, v.outstandingAmount, v.dueDate]);
  if (!signatures.has(key)) signatures.set(key, new Set());
  signatures.get(key).add(signature);
}
return items.map((item, index) => {
  const v = item.json;
  if (v.outputPath !== 'ready_for_review') return item;
  const key = JSON.stringify([v.invoiceId, v.reminderStage]);
  if (signatures.get(key).size > 1) return {json: {...v, classification: 'requiring_manual_review', reminderStage: '', outputPath: 'manual_review', actionReason: 'conflicting_invoice_payload', draft: null}, pairedItem: {item: index}};
  return {json: {...v, historyKey: v.invoiceId.trim() + '::' + v.reminderStage.trim()}, pairedItem: {item: index}};
});`;
const [A, B] = visibleInvoice.input.items[0].invoices;
const otherCustomer = structuredClone(A);
otherCustomer.customer = { ...otherCustomer.customer, id: 'CUST-CONFLICT', email: 'conflict@fixture.example' };
const otherAmount = { ...structuredClone(A), totalAmount: 170, outstandingAmount: 170 };
const invoiceVariants = {
  'customer-conflict': [A, otherCustomer, B],
  'amount-conflict': [otherAmount, B, A],
};

const retryOriginal = await read(join(root, 'examples/retry-isolation/loop.json'));
retryOriginal.nodes.find(node => node.name === 'Render').parameters.jsonBody = '={{ { tenant: $json.tenant, shortId: $json.shortId, revision: $json.revision, renderOptions: $json.styling } }}';
const retryCandidate = structuredClone(retryOriginal);
const retryReference = structuredClone(retryOriginal);
for (const [workflow, expression] of [[retryCandidate, "={{ 'render:' + $json.shortId }}"], [retryReference, '={{ JSON.stringify([$json.tenant, $json.shortId, $json.revision]) }}']]) {
  const node = workflow.nodes.find(node => node.name === 'Render');
  node.parameters.sendHeaders = true;
  node.parameters.headerParameters = { parameters: [{ name: 'Idempotency-Key', value: expression }] };
}
const initial = [42, 43].map(shortId => ({ tenant: 'studio-a', shortId, revision: 'v1', styling: { fontSize: shortId } }));
const newRevision = [{ ...initial[0], revision: 'v2', styling: { fontSize: 80 } }];
const newTenant = [{ ...initial[0], tenant: 'studio-b' }];
const payload = value => ({ tenant: value.tenant, shortId: value.shortId, revision: value.revision, renderOptions: value.styling });
const retrySpec = (name, input) => ({ version: 1, name, input: { node: 'Fixture', items: input }, mocks: [{ node: 'Render', url: '/renders/{{ $json.shortId }}', routes: [{ method: 'POST', path: '/renders/42', responses: [{ status: 200, json: {} }], expect: { count: 0 } }] }], assertions: [{ node: 'Done', count: input.length }] });
const rawCandidate = await read(join(root, 'examples/raw-response/raw-file.json'));
const rawReference = structuredClone(rawCandidate);
Object.assign(rawReference.nodes.find(node => node.name === 'Read receipt'), { type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { mode: 'runOnceForAllItems', jsCode: `const out = []; for (let i = 0; i < $input.all().length; i++) { const bytes = await this.helpers.getBinaryDataBuffer(i, 'data'); out.push({json: {receipt: JSON.parse(bytes.toString('utf8').replace(/^\\uFEFF/, ''))}, pairedItem: {item: i}}); } return out;` } });
const rawVariants = {
  visible: { value: { id: 'receipt-42', status: 'accepted' }, bom: false },
  'top-level-array': { value: [{ id: 'receipt-72', message: '已送达' }, { id: 'receipt-73', message: 'Livré' }], bom: false },
  'bom-unicode': { value: { id: 'receipt-81', message: '已送达 · café · 🛰️' }, bom: true },
};
await save(join(out, 'frozen', 'plan.json'), {
  frozenAt: new Date().toISOString(), stage: 'development seeds, researcher has gold access; no model outcomes',
  provenance: { morsof: 'MIT public workflow at 3d8c61e; author-added same-batch conflict policy', retry: 'self-authored synthetic scope/version repair; response-loss alone is a prior known control', raw: 'self-authored export based on public n8n issue 36402; positive and alternative-correct controls' },
  policy: { morsof: 'All contradictory same-batch invoice+stage members require review; unrelated B must still prepare. Later database conflicts are outside this seed.', retry: 'A logical operation is (tenant, asset, revision). Persist each once across retry/replay, retain distinct tenants and revisions.', raw: 'Preserve one response JSON value per input, including root arrays and optional UTF-8 BOM.' },
  invoiceVariants, retryInputs: { initial, replay: initial, newRevision, newTenant }, rawVariants,
  workflows: { invoiceCandidate, invoiceReference, retryOriginal, retryCandidate, retryReference, rawCandidate, rawReference },
});

for (const [arm, workflow] of [['original', invoiceOriginal], ['candidate', invoiceCandidate], ['reference', invoiceReference]]) {
  const name = `invoice-visible-${arm}`;
  await record(name, await standard(name, workflow, visibleInvoice, join(morsof, 'n8n-datatable.cjs')));
}
for (const [variant, invoices] of Object.entries(invoiceVariants)) for (const [arm, workflow] of [['candidate', invoiceCandidate], ['reference', invoiceReference]]) {
  const name = `invoice-${variant}-${arm}`;
  const spec = { version: 1, name, input: { node: 'Start Manual Test', items: [{ invoices, history: [] }] }, mocks: [], assertions: [{ node: 'Load Fictional Invoice Samples', count: invoices.length }] };
  const report = await standard(name, workflow, spec, join(morsof, 'n8n-datatable.cjs'));
  const execution = await read(join(report.runDirectory, 'execution.json'));
  const outputs = ['Ready for Review', 'Already Prepared', 'Manual Review', 'Invalid Record', 'Workflow Failure', 'No Action Required'].flatMap(node => itemsAt(execution, node));
  const db = new DatabaseSync(join(report.runDirectory, 'n8n-home/.n8n/database.sqlite'), { readOnly: true });
  const table = db.prepare("SELECT id FROM data_table WHERE name='invoice_reminder_history'").get();
  const rows = db.prepare(`SELECT * FROM "data_table_user_${table.id}" ORDER BY id`).all(); db.close();
  await save(join(out, 'results', name, 'stored-rows.json'), rows);
  const ambiguous = outputs.filter(value => value.invoiceId === A.invoiceId);
  const healthy = outputs.filter(value => value.invoiceId === B.invoiceId);
  await record(name, report, [
    eq('preserve one explicit outcome per input', outputs.length, invoices.length),
    eq('ambiguous members retain identities and require review', ambiguous.map(value => [value.customerId, value.outstandingAmount, ['manual_review', 'invalid_record', 'workflow_failure'].includes(value.outputPath), value.draft == null]).sort(), invoices.filter(value => value.invoiceId === A.invoiceId).map(value => [value.customer.id, value.outstandingAmount, true, true]).sort()),
    eq('unrelated B completes', healthy.map(value => value.outputPath), ['ready_for_review']),
    eq('only unambiguous B persists', rows.map(row => [row.invoice_id, row.customer_id, row.outstanding_amount]), [[B.invoiceId, B.customer.id, B.outstandingAmount]]),
  ]);
}

for (const [arm, workflow] of [['original', retryOriginal], ['candidate', retryCandidate], ['reference', retryReference]]) {
  const dir = join(out, 'services', arm); await mkdir(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'effects.sqlite'));
  db.exec('CREATE TABLE effects (id INTEGER PRIMARY KEY, opkey TEXT UNIQUE, payload TEXT NOT NULL)');
  const requests = [];
  const server = await serve(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part;
      const value = JSON.parse(body); const key = req.headers['idempotency-key'] ?? null;
      const inserted = db.prepare('INSERT INTO effects (opkey,payload) VALUES (?,?) ON CONFLICT(opkey) DO NOTHING').run(key, JSON.stringify(value));
      const row = inserted.changes ? db.prepare('SELECT * FROM effects WHERE id=?').get(inserted.lastInsertRowid) : db.prepare('SELECT * FROM effects WHERE opkey=?').get(key);
      const status = requests.length === 0 ? 503 : 200;
      requests.push({ path: req.url, key, body: value, status, effectId: row.id });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 503 ? { error: 'committed; acknowledgement unavailable' } : { id: 'render-' + row.id, request: JSON.parse(row.payload) }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  try {
    const steps = arm === 'original' ? [['visible', initial]] : [['visible', initial], ['same-operation-replay', initial], ['new-revision', newRevision], ['new-tenant', newTenant]];
    const expected = initial.map(payload);
    for (const [step, input] of steps) {
      if (step === 'new-revision' || step === 'new-tenant') expected.push(...input.map(payload));
      const name = `retry-${step}-${arm}`;
      const before = requests.length;
      const report = await external(name, workflow, retrySpec(name, input), server.baseUrl);
      const observed = db.prepare('SELECT * FROM effects ORDER BY id').all();
      await save(join(out, 'results', name, 'stored-rows.json'), observed);
      report.requests = requests.slice(before);
      await record(name, report, [eq('durable effects equal distinct logical operations', observed.map(row => JSON.parse(row.payload)), expected)]);
    }
  } finally { await server.close(); db.close(); await save(join(dir, 'requests.json'), requests); }
}

for (const [variant, response] of Object.entries(rawVariants)) for (const [arm, workflow] of [['candidate', rawCandidate], ['alternative', rawReference]]) {
  const requests = [];
  const server = await serve(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ method: req.method, path: req.url, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end((response.bom ? '\uFEFF' : '') + JSON.stringify(response.value));
  });
  const name = `raw-${variant}-${arm}`;
  const spec = { version: 1, name, input: { node: 'When clicking Test workflow', items: [{}] }, mocks: [{ node: 'Send raw request', url: '/deliver', routes: [{ method: 'POST', path: '/deliver', responses: [{ status: 200, json: response.value }], expect: { count: 1 } }] }], assertions: [{ node: 'Read receipt', equals: [{ receipt: response.value }] }] };
  try {
    const report = await external(name, workflow, spec, server.baseUrl); report.requests = requests;
    await record(name, report, [eq('one unchanged POST body', requests.map(value => value.body), [{ message: 'hello' }])]);
  } finally { await server.close(); }
}

const expectedFailures = new Set(['invoice-visible-original', 'retry-visible-original', ...Object.keys(invoiceVariants).map(key => `invoice-${key}-candidate`), 'retry-new-revision-candidate', 'retry-new-tenant-candidate']);
const unexpected = results.filter(row => row.passed === expectedFailures.has(row.name));
await save(join(out, 'gate.json'), { completedAt: new Date().toISOString(), developmentSeeds: 3, newFailureFamilies: ['invoice same-batch conflict (source-derived, added policy)', 'retry logical-key scope/version (synthetic repair)'], rawPositiveControls: 6, expectedFailures: [...expectedFailures], unexpected, evidenceGatePassed: unexpected.length === 0, modelRuns: 0 });
if (unexpected.length) process.exitCode = 1;
