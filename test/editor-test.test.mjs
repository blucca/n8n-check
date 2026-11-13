import test from 'node:test';
import assert from 'node:assert/strict';
import { editorTestWorkflow } from '../src/editor-test.mjs';

const source = { name: 'Editor test', nodes: [
  { name: 'Input', type: 'n8n-nodes-base.code', position: [0, 0], parameters: {} },
  { name: 'Select', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
], connections: { Input: { main: [[{ node: 'Select', type: 'main', index: 0 }]] } } };
const spec = { version: 1, name: 'IDs', input: { node: 'Input', items: [{ id: 'A' }] },
  mocks: [], assertions: [{ node: 'Select', count: 1, pluck: 'json.id', equals: ['A'] }] };

test('editor oracle runs independently and checks count, IDs, empty and JSON order', () => {
  const workflow = editorTestWorkflow(source, spec);
  const oracle = workflow.nodes.at(-1);
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.connections[workflow.nodes[0].name].main[0][1].node, oracle.name);
  assert.ok(oracle.position[1] > Math.max(...workflow.nodes.slice(0, -1).map(n => n.position[1])));
  const run = (code, items, isExecuted = true) => new Function('$', code)(name => {
    assert.equal(name, 'Select');
    return { isExecuted, all: (output, index) => {
      assert.equal(output, 0); assert.equal(index, 0); return items;
    } };
  });
  assert.equal(run(oracle.parameters.jsCode, [{ json: { id: 'A' } }])[0].json.status, 'passed');
  assert.throws(() => run(oracle.parameters.jsCode, [], false), /expected 1 items, got 0/);
  assert.throws(() => run(oracle.parameters.jsCode, [{ json: { id: 'B' } }]), /differs/);
  assert.throws(() => run(oracle.parameters.jsCode, [{ json: {} }]), /missing json.id/);
  const empty = editorTestWorkflow(source, { ...spec, assertions: [{ node: 'Select', count: 0, equals: [] }] });
  assert.equal(run(empty.nodes.at(-1).parameters.jsCode, [], false)[0].json.status, 'passed');
  const exact = editorTestWorkflow(source, { ...spec, assertions: [{ node: 'Select', equals: [{ a: 1, b: [2, 3] }] }] });
  assert.equal(run(exact.nodes.at(-1).parameters.jsCode, [{ json: { b: [2, 3], a: 1 } }])[0].json.status, 'passed');
  assert.throws(() => run(exact.nodes.at(-1).parameters.jsCode, [{ json: { a: 1, b: [3, 2] } }]), /differs/);
});

test('editor bridge keeps unsupported scheduling and runtime cases on the CLI', () => {
  assert.throws(() => editorTestWorkflow({ ...source, settings: { executionOrder: 'v0' } }, spec), /v1/);
  const merged = structuredClone(source);
  merged.connections.Input.main[0].push({ node: 'Select', type: 'main', index: 0 });
  assert.throws(() => editorTestWorkflow(merged, spec), /one incoming/);
  const wait = structuredClone(source);
  wait.nodes[1].type = 'n8n-nodes-base.wait';
  assert.throws(() => editorTestWorkflow(wait, spec), /local JSON/);
  assert.throws(() => editorTestWorkflow(source, { ...spec, mocks: [{}] }), /without HTTP mocks/);
});
