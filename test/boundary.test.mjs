import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareWorkflow, validateCase } from '../src/workflow.mjs';
import { draftCase } from '../src/case-draft.mjs';

const source = JSON.parse(await readFile(new URL('../examples/stop-after/fixed.json', import.meta.url)));
const spec = JSON.parse(await readFile(new URL('../examples/stop-after/case.json', import.meta.url)));
const copy = value => structuredClone(value);
const link = node => ({ node, type: 'main', index: 0 });
const add = (workflow, name, type = 'n8n-nodes-base.noOp') => workflow.nodes.push({ name, type, parameters: {} });

test('stopAfter runs a bounded slice of the complete export and records the boundary', () => {
  const before = copy(source);
  const result = prepareWorkflow(source, spec, 'http://127.0.0.1:1');
  assert.deepEqual(result.workflow.nodes.map(node => node.name), ['n8n-check start', 'Read invoices', 'Prepare notification']);
  assert.deepEqual(result.omittedNodes, ['Start', 'Notify team']);
  assert.equal(result.workflow.connections['Prepare notification'], undefined);
  assert.match(result.changes.find(change => change.node === spec.stopAfter).change, /remove outgoing connections/);
  assert.deepEqual(source, before);
  const unbounded = copy(spec); delete unbounded.stopAfter;
  assert.throws(() => prepareWorkflow(source, unbounded, ''), /Notify team.*uses credentials/);
});

test('independently reachable branches retain their nodes and connections', () => {
  const workflow = copy(source);
  add(workflow, 'Audit');
  workflow.connections['Read invoices'].main[0].push(link('Audit'));
  const result = prepareWorkflow(workflow, spec, '');
  assert.equal(result.workflow.nodes.some(node => node.name === 'Audit'), true);
  assert.equal(result.workflow.connections['Read invoices'].main[0].length, 2);
  workflow.connections.Audit = { main: [[link('Notify team')]] };
  assert.throws(() => prepareWorkflow(workflow, spec, ''), /Notify team.*uses credentials/);
});

test('stopAfter validates its type, existence and reachability', () => {
  for (const stopAfter of ['', null, 42]) assert.throws(() => validateCase({ ...spec, stopAfter }), /non-empty node name/);
  assert.throws(() => prepareWorkflow(source, { ...spec, stopAfter: 'Missing' }, ''), /stopAfter node not found/);
  assert.throws(() => prepareWorkflow(source, { ...spec, stopAfter: 'Start' }, ''), /must be reachable/);
});

test('stopAfter rejects directed cycles and accepts a node after a completed loop', () => {
  const selfLoop = copy(source);
  selfLoop.connections['Prepare notification'].main[0].push(link('Prepare notification'));
  assert.throws(() => prepareWorkflow(selfLoop, spec, ''), /inside a loop.*completed output/);
  const workflow = copy(source);
  add(workflow, 'Loop'); add(workflow, 'Loop body');
  workflow.connections['Read invoices'] = { main: [[link('Loop')]] };
  workflow.connections.Loop = { main: [[link('Prepare notification')], [link('Loop body')]] };
  workflow.connections['Loop body'] = { main: [[link('Loop')]] };
  assert.throws(() => prepareWorkflow(workflow, { ...spec, stopAfter: 'Loop body' }, ''), /inside a loop.*completed output/);
  assert.equal(prepareWorkflow(workflow, spec, '').workflow.nodes.some(node => node.name === 'Loop body'), true);
});

test('bounded slices preserve original incoming, omitted-reference and assertion checks', () => {
  let workflow = copy(source);
  workflow.connections['Notify team'] = { main: [[link('Read invoices')]] };
  assert.throws(() => prepareWorkflow(workflow, spec, ''), /stopAfter.*inside a loop/);
  workflow = copy(source); add(workflow, 'Audit');
  workflow.connections['Read invoices'].main[0].push(link('Audit'));
  workflow.connections['Notify team'] = { main: [[link('Audit')]] };
  assert.throws(() => prepareWorkflow(workflow, spec, ''), /incoming main connection from "Notify team" to "Audit"/);
  workflow = copy(source);
  workflow.nodes.find(node => node.name === 'Prepare notification').parameters.jsCode = "return $('Notify team').all();";
  assert.throws(() => prepareWorkflow(workflow, spec, ''), /references "Notify team" outside the slice/);
  assert.throws(() => prepareWorkflow(source, { ...spec, assertions: [{ node: 'Notify team', equals: [] }] }, ''), /Assertion node outside the slice/);
});

test('draft mocks, readiness and selected nodes use the same stopped graph as the runner', () => {
  const workflow = copy(source);
  workflow.nodes.find(node => node.name === 'Notify team').type = 'n8n-nodes-base.httpRequest';
  const bounded = draftCase(workflow, { inputNode: 'Read invoices', stopAfter: 'Prepare notification' });
  assert.equal(bounded.ready, true);
  assert.equal(bounded.spec.stopAfter, 'Prepare notification');
  assert.equal(bounded.spec.assertions[0].node, 'Prepare notification');
  assert.deepEqual(bounded.spec.mocks, []);
  assert.deepEqual(bounded.summary.keptNodes, ['Read invoices', 'Prepare notification']);
  assert.deepEqual(bounded.summary.omittedNodes, prepareWorkflow(workflow, bounded.spec, '').omittedNodes);
  const unbounded = draftCase(workflow, { inputNode: 'Read invoices', assertNode: 'Prepare notification' });
  assert.equal(unbounded.ready, false);
  assert.deepEqual(unbounded.summary.httpNodes, ['Notify team']);
  add(workflow, 'Audit HTTP', 'n8n-nodes-base.httpRequest');
  workflow.connections['Read invoices'].main[0].push(link('Audit HTTP'));
  const sibling = draftCase(workflow, { inputNode: 'Read invoices', stopAfter: 'Prepare notification' });
  assert.deepEqual(sibling.summary.httpNodes, ['Audit HTTP']);
  assert.equal(sibling.ready, false);
  delete workflow.pinData;
  const invalid = draftCase(workflow, { inputNode: 'Read invoices', stopAfter: 'Start' });
  assert.equal(invalid.issues.some(issue => issue.code === 'slice_structure' && /must be reachable/.test(issue.message)), true);
});
