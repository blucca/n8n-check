import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { summary, workspacePath, dockerArguments } from '../src/action.mjs';
import { version } from '../src/version.mjs';

test('CLI, package and runtime use one version source', () => {
  const cli = new URL('../bin/n8n-check.mjs', import.meta.url);
  assert.equal(execFileSync(process.execPath, [cli.pathname, '--version'], { encoding: 'utf8' }).trim(), version);
  assert.match(execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' }), new RegExp(`n8n-check ${version}`));
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version, version);
});

test('Action summary presents mismatches, request sequence and escaped values', () => {
  const text = summary({ name: 'Case | <script>', status: 'failed', n8nVersion: '2.41.7', runnerVersion: version,
    checks: [{ name: 'Payload | body', passed: false, expected: { count: 1 }, actual: '</pre><script>x</script>' }],
    requests: [{ node: 'HTTP', method: 'POST', path: '/one|two', status: 503 }] });
  assert.match(text, /0\/1 checks/); assert.match(text, /1 HTTP requests/);
  assert.match(text, /\| 1 \| HTTP \| POST \| \/one&#124;two \| 503 \|/);
  assert.match(text, /&lt;script&gt;/); assert.equal(text.includes('<script>'), false);
});

test('Action validates workspace paths and symlink escapes', () => {
  const base = resolve(process.env.N8N_CHECK_TEST_TEMP || 'temp');
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'action-test-'));
  const root = join(temp, 'workspace'); mkdirSync(root);
  writeFileSync(join(root, 'fixture with space.json'), '{}');
  symlinkSync(temp, join(root, 'escape'));
  try {
    assert.equal(workspacePath(root, 'fixture with space.json', 'workflow'), join(root, 'fixture with space.json'));
    assert.equal(workspacePath(root, 'nested/results', 'out'), join(root, 'nested/results'));
    for (const input of ['.', '../outside', '/absolute', 'escape/report', 'bad\nname']) assert.throws(() => workspacePath(root, input, 'out'));
    assert.throws(() => workspacePath(root, 'missing.json', 'case'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Action mounts only input files and reports, preserves spaces, isolates network', () => {
  const args = dockerArguments({ workflow: '/repo/my workflow.json', caseFile: '/repo/case.json', out: '/repo/results', image: 'test:1', uid: 1001, gid: 1001 });
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--user') + 1], '1001:1001');
  assert.ok(args.includes('type=bind,source=/repo/my workflow.json,target=/inputs/workflow.json,readonly'));
  assert.ok(args.includes('type=bind,source=/repo/case.json,target=/inputs/case.json,readonly'));
  assert.ok(args.includes('type=bind,source=/repo/results,target=/results'));
});
