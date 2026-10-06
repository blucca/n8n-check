import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareWorkflow, validateCase } from '../src/workflow.mjs';
import { executionChecks, junit } from '../src/report.mjs';

const spec = JSON.parse(await readFile(new URL('../examples/identity-projection/case.json', import.meta.url)));
const workflow = JSON.parse(await readFile(new URL('../examples/identity-projection/workflow.json', import.meta.url)));
const run = items => ({ data: { main: [items.map(json => ({ json }))] } });
const execution = runs => ({ data: { resultData: { runData: { 'Select rows': runs } } } });
const checks = (items, assertions = spec.assertions) => executionChecks(execution([run(items)]), { exitCode: 0 }, assertions);

test('identity fixture prepares and accepts changing unrelated metadata', () => {
  assert.equal(validateCase(spec), spec);
  assert.equal(prepareWorkflow(workflow, spec, '').workflow.nodes.length, 3);
  const rows = spec.input.items;
  const code = workflow.nodes.find(node => node.name === 'Select rows').parameters.jsCode;
  const output = new Function('$input', code)({ all: () => rows.map(json => ({ json })) });
  assert.equal(checks(output.map(item => item.json)).every(check => check.passed), true);
  assert.equal(checks([{ id: 'row-A', processedAt: 'next week' }, { id: 'row-B', score: 0.95 }]).every(check => check.passed), true);
});

test('count and identity surface dropped rows and same-count substitution or reordering', () => {
  const dropped = checks([{ id: 'row-A' }]);
  assert.deepEqual(dropped.map(check => check.passed), [true, false, false]);
  for (const ids of [['row-A', 'wrong'], ['row-B', 'row-A'], ['row-A', 'row-A']]) {
    const result = checks(ids.map(id => ({ id })));
    assert.deepEqual(result.map(check => check.passed), [true, true, false]);
    assert.deepEqual(result[2].actual, ids);
  }
});

test('projection and count share output selection and execution order', () => {
  const runs = ['row-A', 'row-B'].map(id => ({ data: { main: [[{ json: { id: 'ignored' } }], [{ json: { id } }]] } }));
  const result = executionChecks(execution(runs), { exitCode: 0 }, [{ ...spec.assertions[0], output: 1 }]);
  assert.equal(result.every(check => check.passed), true);
  assert.deepEqual(result[2].actual, ['row-A', 'row-B']);
});

test('count-only, empty outputs and nested own-property paths are supported', () => {
  assert.equal(checks([], [{ node: 'Select rows', count: 0 }]).every(check => check.passed), true);
  assert.equal(checks([], [{ node: 'Select rows', pluck: 'json.id', equals: [] }]).every(check => check.passed), true);
  assert.equal(checks([{ refs: [{ id: null }] }], [{ node: 'Select rows', pluck: 'json.refs.0.id', equals: [null] }])[1].passed, true);
});

test('missing fields and inherited properties fail with item indexes in reports', () => {
  for (const row of [{}, { id: null }, Object.create({ id: 'row-A' })]) {
    const assertion = { node: 'Select rows', pluck: row.id === null ? 'json.id.child' : 'json.id', equals: [null] };
    const result = checks([row], [assertion]);
    assert.equal(result[1].passed, false);
    assert.deepEqual(result[1].actual.missingItems, [0]);
    assert.match(junit({ name: 'missing field', status: 'failed', durationMs: 0, checks: result }), /missingItems/);
  }
});

test('validates count and projection contracts before execution', () => {
  for (const assertion of [
    null, {}, { node: 'Select rows' }, { node: '', equals: [] },
    ...[-1, 1.5, Infinity, '2', null].map(count => ({ node: 'Select rows', count })),
    ...['', '.json', 'json.', 'json..id', 1, null].map(pluck => ({ node: 'Select rows', pluck, equals: [] })),
    { node: 'Select rows', count: 2, pluck: 'json.id' }, { node: 'Select rows', equals: 2 },
  ]) assert.throws(() => validateCase({ ...spec, assertions: [assertion] }));
  assert.doesNotThrow(() => validateCase({ ...spec, assertions: [{ node: 'Select rows', count: 0 }] }));
});
