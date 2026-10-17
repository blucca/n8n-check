// Node 24+, n8n 2.41.7 on PATH, and a loopback-only network namespace.
// Each request gets a fresh output directory; retry cases share durable effects.
import { readFile, writeFile, mkdir, readdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { runtimeEnv, command, checkNetwork } from '../../src/runner.mjs';
import { prepareWorkflow } from '../../src/workflow.mjs';
import { executionFrom, executionChecks } from '../../src/report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const eq = (name, actual, expected) => ({ name, passed: isDeepStrictEqual(actual, expected), actual, expected });
const sorted = values => [...values].sort((a, b) => (JSON.stringify(a) ?? '').localeCompare(JSON.stringify(b) ?? ''));
const itemsAt = (execution, name) => (execution?.data?.resultData?.runData?.[name] ?? []).flatMap(run => run.data?.main?.[0] ?? []).map(item => item.json);
const payload = value => ({ tenant: value.tenant, shortId: value.shortId, revision: value.revision, renderOptions: value.styling });
const candidateFailure = error => ({ name: 'n8n execution succeeds', passed: false, actual: { candidateError: error }, expected: 'successful execution' });

// A malformed repair may fail preparation/import. Filesystem and runtime faults
// remain harness errors, so a broken host cannot count as a failed model repair.
function checkProcess(result) {
  const message = [result.error, result.stdout, result.stderr].filter(Boolean).join('\n');
  if (/\b(?:EACCES|EPERM|ENOSPC|EROFS|EMFILE|ENFILE|ENOMEM)\b|spawn .*ENOENT/.test(message)) {
    throw Error('Harness process failure: ' + message.slice(-4000));
  }
}

async function execute(workflow, spec, dir, n8n, baseUrl = 'http://127.0.0.1') {
  await mkdir(join(dir, 'n8n-home', 'tmp'), { recursive: true });
  await save(join(dir, 'case.json'), spec);
  let prepared;
  try { prepared = prepareWorkflow(workflow, spec, baseUrl); }
  catch (error) { return { checks: [candidateFailure(error.message)], execution: null, runDirectory: dir }; }
  const env = runtimeEnv(join(dir, 'n8n-home'));
  const path = join(dir, 'workflow.json');
  await save(path, prepared.workflow);
  const invoke = async (args, name, timeout) => {
    const result = await command(n8n, args, env, timeout);
    await writeFile(join(dir, `${name}.stdout.log`), result.stdout);
    await writeFile(join(dir, `${name}.stderr.log`), result.stderr);
    await save(join(dir, `${name}.process.json`), { exitCode: result.exitCode, signal: result.signal, error: result.error });
    checkProcess(result);
    return result;
  };
  const imported = await invoke(['import:workflow', '--input=' + path], 'import');
  if (imported.exitCode !== 0 || imported.error) {
    return { checks: [candidateFailure('Import failed: ' + (imported.error || imported.stderr || imported.stdout).slice(-4000))], execution: null, runDirectory: dir };
  }
  const raw = await invoke(['execute', '--id=' + prepared.workflow.id, '--rawOutput'], 'execute', 60000);
  const execution = executionFrom(raw.stdout + '\n' + raw.stderr);
  await save(join(dir, 'execution.json'), execution);
  return { checks: executionChecks(execution, raw, spec.assertions), execution, runDirectory: dir };
}

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(yes => { server.close(yes); server.closeAllConnections(); }) };
}

async function invoiceRows(dir) {
  const file = join(dir, 'n8n-home/.n8n/database.sqlite');
  try { await stat(file); }
  catch (error) { if (error.code === 'ENOENT') return { error: 'n8n SQLite database is missing' }; throw error; }
  await access(file, constants.R_OK);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const table = db.prepare("SELECT id FROM data_table WHERE name='invoice_reminder_history'").get();
    if (!table) return { error: 'invoice_reminder_history Data Table is missing' };
    return { rows: db.prepare(`SELECT * FROM "data_table_user_${String(table.id).replaceAll('"', '""')}" ORDER BY id`).all() };
  } catch (error) {
    if (/no such table:/.test(error.message)) return { error: error.message };
    throw error;
  } finally { db.close(); }
}

function validate(request) {
  if (!['invoice', 'retry', 'raw'].includes(request.family) || !Array.isArray(request.cases) || !request.cases.length) throw Error('Request needs family invoice|retry|raw and nonempty cases');
  for (const entry of request.cases) {
    if (typeof entry.name !== 'string' || !entry.name) throw Error('Each case needs a name');
    if (request.family === 'invoice' && (!Array.isArray(entry.invoices) || !Array.isArray(entry.expectedOutputs) || !Array.isArray(entry.expectedRows))) throw Error('Invoice case needs invoices, expectedOutputs, expectedRows arrays');
    if (request.family === 'retry' && (!Array.isArray(entry.input) || !Array.isArray(entry.expectedEffects))) throw Error('Retry case needs input and cumulative expectedEffects arrays');
    if (request.family === 'raw' && (!Object.hasOwn(entry, 'value') || typeof entry.bom !== 'boolean')) throw Error('Raw case needs value and boolean bom');
  }
}

async function main() {
  if (process.argv.length !== 4) throw Error('Usage: node pilot-evaluate.mjs REQUEST.json OUTDIR');
  const request = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  validate(request);
  const network = await checkNetwork(false);
  const out = resolve(process.argv[3]);
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw Error('OUTDIR must be fresh or empty: ' + out);
  await save(join(out, 'request.json'), request);
  const n8n = request.family === 'invoice' ? join(root, 'examples/morsof-invoice-history/n8n-datatable.cjs') : 'n8n';
  const home = join(out, 'runtime-home');
  await mkdir(join(home, 'tmp'), { recursive: true });
  const version = await command(n8n, ['--version'], runtimeEnv(home));
  await writeFile(join(out, 'version.log'), version.stdout + version.stderr);
  if (version.error || version.exitCode !== 0 || version.stdout.trim() !== '2.41.7') throw Error('Harness requires n8n 2.41.7: ' + (version.error || version.stderr || version.stdout));
  const report = { family: request.family, passed: false, startedAt: new Date().toISOString(), runtime: 'n8n 2.41.7', network, cases: [] };
  const requests = [];
  let db, retryServer, serviceError;
  if (request.family === 'retry') {
    db = new DatabaseSync(join(out, 'effects.sqlite'));
    db.exec('CREATE TABLE effects (id INTEGER PRIMARY KEY, opkey TEXT UNIQUE, payload TEXT NOT NULL)');
    retryServer = await serve(async (req, res) => {
      let rawBody = ''; for await (const part of req) rawBody += part;
      const observed = { method: req.method, path: req.url, key: req.headers['idempotency-key'] ?? null, rawBody };
      try { observed.body = JSON.parse(rawBody); }
      catch (error) { requests.push({ ...observed, status: 400, error: error.message }); res.writeHead(400); res.end('invalid JSON'); return; }
      try {
        const inserted = db.prepare('INSERT INTO effects (opkey,payload) VALUES (?,?) ON CONFLICT(opkey) DO NOTHING').run(observed.key, JSON.stringify(observed.body));
        const row = inserted.changes ? db.prepare('SELECT * FROM effects WHERE id=?').get(inserted.lastInsertRowid) : db.prepare('SELECT * FROM effects WHERE opkey=?').get(observed.key);
        const status = requests.length === 0 ? 503 : 200;
        requests.push({ ...observed, status, effectId: row.id });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status === 503 ? { error: 'committed; acknowledgement unavailable' } : { id: 'render-' + row.id, request: JSON.parse(row.payload) }));
      } catch (error) { serviceError = error; res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
    });
  }
  try {
    for (const [index, entry] of request.cases.entries()) {
      const dir = join(out, 'cases', String(index).padStart(3, '0'));
      const spec = { version: 1, name: entry.name, mocks: [] };
      let result, caseRequests = [];
      if (request.family === 'invoice') {
        spec.input = { node: 'Start Manual Test', items: [{ invoices: entry.invoices, history: [] }] };
        spec.assertions = [{ node: 'Load Fictional Invoice Samples', count: entry.invoices.length }];
        result = await execute(request.workflow, spec, dir, n8n);
        const outputs = ['Ready for Review', 'Already Prepared', 'Manual Review', 'Invalid Record', 'Workflow Failure', 'No Action Required'].flatMap(node => itemsAt(result.execution, node));
        const actualOutputs = outputs.map(v => ({ invoiceId: v.invoiceId, customerId: v.customerId, email: v.email, outstandingAmount: v.outstandingAmount, outcome: ['manual_review', 'invalid_record', 'workflow_failure'].includes(v.outputPath) ? 'review' : v.outputPath, draftNull: v.draft == null }));
        const stored = await invoiceRows(dir);
        await save(join(dir, 'stored-rows.json'), stored);
        await save(join(dir, 'outputs.json'), outputs);
        const expectedOutputs = entry.expectedOutputs.map(v => ({ invoiceId: v.invoiceId, customerId: v.customerId, email: v.email, outstandingAmount: v.outstandingAmount, outcome: v.outcome, draftNull: v.draftNull }));
        const expectedRows = entry.expectedRows.map(v => ({ invoiceId: v.invoiceId, customerId: v.customerId, outstandingAmount: v.outstandingAmount, stage: v.stage }));
        result.checks.push(eq('terminal outcomes preserve all invoice fields', sorted(actualOutputs), sorted(expectedOutputs)));
        result.checks.push(eq('durable invoice history equals expected rows', stored.error ? { error: stored.error } : sorted(stored.rows.map(v => ({ invoiceId: v.invoice_id, customerId: v.customer_id, outstandingAmount: v.outstanding_amount, stage: v.reminder_stage }))), sorted(expectedRows)));
      } else if (request.family === 'retry') {
        spec.input = { node: 'Fixture', items: entry.input };
        spec.mocks = [{ node: 'Render', url: '/renders/{{ $json.shortId }}', routes: [{ method: 'POST', path: '/renders/42', responses: [{ status: 200, json: {} }], expect: { count: 0 } }] }];
        spec.assertions = [{ node: 'Done', count: entry.input.length }];
        const before = requests.length;
        result = await execute(request.workflow, spec, dir, n8n, retryServer.baseUrl);
        if (serviceError) throw serviceError;
        caseRequests = requests.slice(before);
        const stored = db.prepare('SELECT * FROM effects ORDER BY id').all();
        await save(join(dir, 'stored-rows.json'), stored);
        result.checks.push(eq('durable effects equal distinct logical operations', sorted(stored.map(row => JSON.parse(row.payload))), sorted(entry.expectedEffects)));
        result.checks.push(eq('Done receipts match current inputs', sorted(itemsAt(result.execution, 'Done').map(v => v.request)), sorted(entry.input.map(payload))));
      } else {
        const server = await serve(async (req, res) => {
          let rawBody = ''; for await (const part of req) rawBody += part;
          let body; try { body = JSON.parse(rawBody); } catch { body = { invalidJson: rawBody }; }
          caseRequests.push({ method: req.method, path: req.url, body, rawBody });
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end((entry.bom ? '\uFEFF' : '') + JSON.stringify(entry.value));
        });
        spec.input = { node: 'When clicking Test workflow', items: [{}] };
        spec.mocks = [{ node: 'Send raw request', url: '/deliver', routes: [{ method: 'POST', path: '/deliver', responses: [{ status: 200, json: entry.value }], expect: { count: 1 } }] }];
        spec.assertions = [{ node: 'Read receipt', equals: [{ receipt: entry.value }] }];
        try { result = await execute(request.workflow, spec, dir, n8n, server.baseUrl); }
        finally { await server.close(); }
        result.checks.push(eq('one unchanged POST body', caseRequests.map(v => ({ method: v.method, body: v.body })), [{ method: 'POST', body: { message: 'hello' } }]));
      }
      const row = { name: entry.name, passed: result.checks.every(check => check.passed), enginePassed: result.checks.find(check => check.name === 'n8n execution succeeds')?.passed ?? false, checks: result.checks, runDirectory: dir, requests: caseRequests };
      await save(join(dir, 'oracle.json'), row);
      report.cases.push(row);
      await save(join(out, 'requests.json'), requests.length ? requests : report.cases.flatMap(v => v.requests));
      await save(join(out, 'report.json'), report);
      console.log(JSON.stringify({ family: request.family, name: row.name, passed: row.passed, enginePassed: row.enginePassed, failed: row.checks.filter(check => !check.passed).map(check => check.name) }));
    }
    report.passed = report.cases.every(row => row.passed);
    report.completedAt = new Date().toISOString();
    await save(join(out, 'report.json'), report);
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (retryServer) await retryServer.close();
    if (db) db.close();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 2; });
