import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkflow, draftCase } from '../src/case-draft.mjs';
import { prepareWorkflow } from '../src/workflow.mjs';

const source = {
  name: 'Pinned mapping',
  nodes: [
    { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
    { name: 'Input', type: 'n8n-nodes-base.noOp', parameters: {} },
    { name: 'Mapped', type: 'n8n-nodes-base.code', parameters: { mode: 'runOnceForAllItems', jsCode: 'return $input.all().map(item => ({ json: { id: item.json.id, accepted: true } }));' } },
  ],
  connections: { Trigger: { main: [[{ node: 'Input', type: 'main', index: 0 }]] }, Input: { main: [[{ node: 'Mapped', type: 'main', index: 0 }]] } },
  pinData: { Input: [{ json: { id: 42 }, pairedItem: { item: 0 } }], Mapped: [{ json: { id: 42, accepted: true } }] },
};
const copy = () => structuredClone(source);

test('pinned local workflow yields a runnable case without modifying its export', () => {
  const workflow = copy(); const before = structuredClone(workflow);
  const inspected = inspectWorkflow([workflow]);
  assert.equal(inspected.suggestedInputNode, 'Input');
  assert.equal(inspected.suggestedAssertNode, 'Mapped');
  assert.deepEqual(inspected.nodes[1], { name: 'Input', type: 'n8n-nodes-base.noOp', hasPinData: true, pinItemCount: 1 });
  const result = draftCase([workflow]);
  assert.equal(result.ready, true); assert.deepEqual(result.issues, []);
  assert.deepEqual(result.spec.input.items, [{ id: 42 }]);
  assert.deepEqual(result.spec.assertions[0].equals, [{ id: 42, accepted: true }]);
  assert.deepEqual(result.summary.omittedNodes, ['Trigger']);
  assert.equal(prepareWorkflow(workflow, result.spec, 'http://127.0.0.1:1').workflow.pinData, undefined);
  assert.deepEqual(workflow, before);
});

test('missing snapshots remain null; explicit JSON arrays finish the draft', () => {
  const workflow = copy(); delete workflow.pinData;
  const options = { inputNode: 'Input', assertNode: 'Mapped' };
  const result = draftCase(workflow, options);
  assert.equal(result.ready, false); assert.equal(result.spec.input.items, null); assert.equal(result.spec.assertions[0].equals, null);
  assert.equal(result.issues.filter(issue => issue.code === 'items_required').length, 2);
  assert.equal(draftCase(workflow, { ...options, inputItems: [{ id: 1 }], expectedItems: [{ id: 1, accepted: true }] }).ready, true);
});

test('HTTP pin data supplies output expectations; HTTP contracts keep authored placeholders', () => {
  const workflow = copy(); workflow.nodes[2].type = 'n8n-nodes-base.httpRequest';
  workflow.nodes[2].parameters = { url: 'https://example.test/create?kind=person', method: 'POST' };
  const result = draftCase(workflow);
  assert.equal(result.ready, false); assert.deepEqual(result.summary.httpNodes, ['Mapped']);
  const mock = result.spec.mocks[0];
  assert.equal(mock.url, '/create?kind=person'); assert.equal(mock.routes[0].method, 'POST');
  assert.equal(mock.routes[0].expect.count, null); assert.equal(mock.routes[0].responses[0].status, null); assert.equal(mock.routes[0].responses[0].json, null);
  mock.routes[0].expect.count = 1; mock.routes[0].responses = [{ status: 200, json: { id: 42, accepted: true } }];
  assert.equal(draftCase(workflow, { mocks: [mock] }).ready, true);
  workflow.nodes[2].parameters.url = '=https://example.test/{{ $json.id }}';
  const pending = draftCase(workflow).spec.mocks[0];
  assert.equal(pending.url, '/TODO');
  pending.routes[0].expect.count = 1; pending.routes[0].responses = [{ status: 200, json: { id: 42, accepted: true } }];
  assert.equal(draftCase(workflow, { mocks: [pending] }).issues.some(issue => issue.code === 'mock_path_required'), true);
  pending.url = '/items/42';
  assert.equal(draftCase(workflow, { mocks: [pending] }).ready, false);
  pending.routes[0].path = '/items/42';
  assert.equal(draftCase(workflow, { mocks: [pending] }).ready, true);
});

test('slice feedback is available while JSON and HTTP fields are pending', () => {
  const workflow = copy(); delete workflow.pinData;
  workflow.nodes[2].parameters.jsCode = 'return $("Trigger").all();';
  let result = draftCase(workflow, { inputNode: 'Input' });
  assert.equal(result.ready, false); assert.match(result.issues.find(issue => issue.code === 'slice_structure').message, /references "Trigger" outside/);
  workflow.nodes[2].parameters.jsCode = '';
  workflow.connections.Mapped = { main: [[{ node: 'Input', type: 'main', index: 0 }]] };
  result = draftCase(workflow, { inputNode: 'Input', assertNode: 'Mapped' });
  assert.match(result.issues.find(issue => issue.code === 'slice_structure').message, /inside a loop/);
});

test('self assertions, binary pins, legacy raw pins, empty input and nonzero branch need author input', () => {
  assert.equal(draftCase(source, { assertNode: 'Input' }).issues.some(issue => issue.code === 'assert_downstream'), true);
  const workflow = copy(); workflow.pinData.Input[0].binary = { data: {} };
  assert.equal(draftCase(workflow).spec.input.items, null);
  workflow.pinData.Input = [{ id: 42 }];
  assert.equal(draftCase(workflow).spec.input.items, null);
  workflow.pinData.Input = [];
  assert.equal(draftCase(workflow, { inputNode: 'Input' }).issues.some(issue => issue.code === 'input_empty'), true);
  assert.equal(draftCase(source, { output: 1 }).spec.assertions[0].equals, null);
  assert.equal(draftCase(source, { output: 1, expectedItems: [] }).ready, true);
});

test('bad export shape and invalid authored mock produce actionable feedback', () => {
  assert.throws(() => inspectWorkflow([source, source]), /multiple workflows/);
  assert.throws(() => inspectWorkflow({ nodes: [], connections: { A: 7 } }), /Invalid connections/);
  const workflow = copy(); workflow.nodes[2].type = 'n8n-nodes-base.httpRequest';
  assert.equal(draftCase(workflow, { mocks: [] }).issues.some(issue => /needs a mock entry/.test(issue.message)), true);
  assert.equal(draftCase(workflow, { mocks: null }).issues.some(issue => /mocks must be an array/.test(issue.message)), true);
});

test('init writes a first draft without a runtime and protects existing files', async t => {
  const root = process.env.N8N_CHECK_TEST_TEMP || fileURLToPath(new URL('../temp/draft-tests/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'draft-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workflow = join(dir, 'workflow.json'); const out = join(dir, 'case.json');
  await writeFile(workflow, JSON.stringify(source));
  const cli = new URL('../bin/n8n-check.mjs', import.meta.url);
  const run = () => spawnSync(process.execPath, [cli.pathname, 'init', workflow, '--input', 'Input', '--assert', 'Mapped', '--stop-after', 'Mapped', '--out', out], { encoding: 'utf8', env: { ...process.env, N8N_BINARY: '/runtime-intentionally-absent' } });
  const first = run(); assert.equal(first.status, 0, first.stderr); assert.match(first.stdout, /ready for a first run/);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).input.items, [{ id: 42 }]);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).stopAfter, 'Mapped');
  assert.match(first.stdout, /Stop after: Mapped/);
  const second = run(); assert.equal(second.status, 2); assert.match(second.stderr, /File already exists/);
});
