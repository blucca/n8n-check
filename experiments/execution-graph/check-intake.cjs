// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// Loopback replay of the native each/allRuns records. All output is local.
// Usage: node check-intake.cjs OUTPUT_DIR [FIXTURE_DIR]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { childIds } = require('./fetch-bundle.cjs');
const run = promisify(execFile);

async function main() {
  assert.ok(process.argv.length >= 3 && process.argv.length <= 4,
    'Usage: node check-intake.cjs OUTPUT_DIR [FIXTURE_DIR]');
  const output = path.resolve(process.argv[2]);
  const fixtures = path.resolve(process.argv[3] ?? path.join(__dirname, 'recorded/each-allruns'));
  assert.equal(fs.existsSync(output), false, 'Choose a fresh check OUTPUT_DIR');
  fs.mkdirSync(output, { recursive: true });
  const roles = ['parent', 'child-0', 'child-1', 'child-2'];
  const records = roles.map(role => {
    const raw = fs.readFileSync(path.join(fixtures, `${role}-execution.json`));
    return { id: String(JSON.parse(raw).id), raw };
  });
  const byId = new Map(records.map(record => [record.id, record.raw]));
  const apiKey = 'local-intake-fixture-key';
  const requests = [];
  let missingId;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    const match = url.pathname.match(/^\/api\/v1\/executions\/([^/]+)$/);
    const identifier = match ? decodeURIComponent(match[1]) : undefined;
    requests.push({ method: request.method, path: request.url, id: identifier,
      includeData: url.searchParams.get('includeData'), api_key_match: request.headers['x-n8n-api-key'] === apiKey });
    const raw = identifier !== missingId && byId.get(identifier);
    response.writeHead(raw ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(raw || '{"message":"fixture child unavailable"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function fetchInto(directory) {
    const args = [path.join(__dirname, 'fetch-bundle.cjs'), base, records[0].id, directory];
    try {
      return { code: 0, ...await run(process.execPath, args, { env: { ...process.env, N8N_API_KEY: apiKey } }) };
    } catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  }
  function checkRequests(rows) {
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => row.id), records.map(record => record.id));
    for (const row of rows) {
      assert.equal(row.method, 'GET');
      assert.equal(row.path, `/api/v1/executions/${row.id}?includeData=true`);
      assert.equal(row.includeData, 'true');
      assert.equal(row.api_key_match, true);
    }
  }
  try {
    const completeDir = path.join(output, 'complete');
    const complete = await fetchInto(completeDir);
    assert.equal(complete.code, 0, complete.stderr);
    assert.equal(complete.stderr, '');
    checkRequests(requests);
    const manifest = JSON.parse(fs.readFileSync(path.join(completeDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.parent_execution, records[0].id);
    assert.deepEqual(manifest.executions.map(row => row.id), records.map(record => record.id));
    const files = manifest.executions.map(row => path.join(completeDir, row.file));
    for (const [i, row] of manifest.executions.entries()) {
      const saved = fs.readFileSync(files[i]);
      assert.deepEqual(saved, records[i].raw);
      assert.equal(String(JSON.parse(saved).id), row.id);
      assert.equal(row.bytes, saved.length);
    }
    for (const line of complete.stdout.trim().split('\n')) {
      const row = JSON.parse(line);
      assert.deepEqual(Object.keys(row), row.status === 'complete'
        ? ['status', 'file', 'execution_ids'] : ['execution_id', 'file']);
    }
    assert.equal(complete.stdout.includes(apiKey), false);
    const audit = await run(process.execPath, [path.join(__dirname, 'audit-bundle.cjs'), ...files]);
    const graph = JSON.parse(audit.stdout);
    assert.equal(graph.status, 'consistent');
    assert.equal(graph.execution_count, 4);
    assert.equal(graph.boundary_count, 3);
    assert.equal(graph.checked_items, 9);
    assert.equal(graph.mismatches, 0);
    fs.writeFileSync(path.join(output, 'graph-audit.json'), audit.stdout);

    // once-mode IDs live on tasks, including the bridge's next child call.
    for (const role of ['parent', 'bridge']) {
      const execution = JSON.parse(fs.readFileSync(path.join(__dirname,
        `recorded/nested-input1-${role}-execution.json`), 'utf8'));
      const taskEdges = Object.values(execution.data.resultData.runData)
        .flatMap(runs => runs.map(task => task.metadata?.subExecution).filter(Boolean));
      assert.equal(taskEdges.length, 1);
      assert.deepEqual(childIds(execution), taskEdges.map(edge => String(edge.executionId)));
    }

    missingId = records.at(-1).id;
    const requestCut = requests.length;
    const missingDir = path.join(output, 'missing-child');
    const missing = await fetchInto(missingDir);
    assert.equal(missing.code, 2);
    const failure = JSON.parse(missing.stderr);
    assert.equal(failure.status, 'incomplete');
    assert.equal(failure.reason, `Execution ${missingId}: HTTP 404`);
    checkRequests(requests.slice(requestCut));
    assert.equal(fs.existsSync(path.join(missingDir, 'manifest.json')), false);
    assert.equal(fs.readdirSync(missingDir).length, 3);
    assert.equal((missing.stdout + missing.stderr).includes(apiKey), false);
    fs.writeFileSync(path.join(output, 'incomplete.json'), missing.stderr);
    const report = { status: 'PASS', fixture_dir: fixtures,
      complete: { get_count: 4, execution_ids: records.map(record => record.id),
        preserved_bytes: records.map(record => record.raw.length),
        audit_status: graph.status, checked_items: graph.checked_items },
      missing_child: { get_count: 4, execution_id: missingId, status: failure.status,
        exit_code: missing.code, complete_manifest: false }, requests };
    fs.writeFileSync(path.join(output, 'check-result.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write('PASS: four includeData=true GETs, exact bytes/IDs, consistent/9; missing child incomplete, complete manifest absent\n');
  } finally { await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
