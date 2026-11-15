import test from 'node:test';
import assert from 'node:assert/strict';
import { editorTestWorkflow } from '../src/editor-test.mjs';

test('field edits preserve authored expectations/count while untouched pins follow the field', async t => {
  // Dispatch the real app callbacks; the DOM shim covers only this editing path.
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      get value() { return this._value ?? ''; },
      set value(value) { this._value = String(value); },
      textContent: '', innerHTML: '', handlers: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      replaceChildren() {},
    });
    return elements.get(id);
  };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: get, querySelector: get, createElement: () => get(Symbol()) };
  t.after(() => { globalThis.document = previousDocument; });
  await import('../web/app.mjs');
  const edit = (id, value, type = 'input') => {
    get(id).value = value;
    get(id).handlers[type]({ target: get(id) });
  };
  const workflow = {
    name: 'Owner mapping',
    nodes: [
      { name: 'Input', type: 'n8n-nodes-base.noOp', parameters: {} },
      { name: 'Mapped', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [];' } },
    ],
    connections: { Input: { main: [[{ node: 'Mapped', type: 'main', index: 0 }]] } },
    pinData: { Input: [{ json: { id: 42 } }], Mapped: [] },
  };
  const load = () => {
    get('source').value = JSON.stringify(workflow);
    get('load-paste').handlers.click();
    edit('assertion-mode', 'pluck', 'change');
  };

  load();
  edit('expected-items', '[42]');
  edit('expected-count', '1');
  edit('pluck-path', 'json.');
  assert.equal(get('download-editor-test').disabled, true);
  edit('pluck-path', 'json.id');
  assert.equal(get('expected-items').value, '[42]');
  assert.equal(get('expected-count').value, '1');
  assert.equal(get('expected-origin').textContent, 'Edited expectation');
  assert.equal(get('download-editor-test').disabled, false);
  const spec = JSON.parse(get('preview').textContent);
  const generated = editorTestWorkflow(workflow, spec);
  assert.throws(() => new Function('$', generated.nodes.at(-1).parameters.jsCode)(
    () => ({ isExecuted: true, all: () => [] })), /expected 1 items, got 0/);
  edit('assertion-mode', 'exact', 'change');
  edit('assertion-mode', 'pluck', 'change');
  assert.equal(get('expected-items').value, '[42]');
  assert.equal(get('expected-count').value, '1');

  workflow.pinData.Mapped = [{ json: { id: 42, accepted: true } }];
  load();
  edit('expected-count', '0');
  edit('pluck-path', 'json.accepted');
  assert.equal(get('expected-count').value, '0');
  assert.deepEqual(JSON.parse(get('expected-items').value), [true]);
  assert.equal(get('download-editor-test').disabled, true);
  load();
  edit('pluck-path', 'json.accepted');
  assert.equal(get('expected-count').value, '1');
  assert.deepEqual(JSON.parse(get('expected-items').value), [true]);
  assert.equal(get('download-editor-test').disabled, false);
});
