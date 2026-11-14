// Rebuild this fixed, three-order contract from the repository checkout.
// Decimal-point amounts in this fixture use JavaScript Number as the sort key;
// the original orderTotal strings remain unchanged in the returned JSON.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { editorTestWorkflow } from '../../src/editor-test.mjs';
import { prepareWorkflow } from '../../src/workflow.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const input = [
  { id: 'order-A', orderTotal: '96.74', customer: 'Example Alpha' },
  { id: 'order-B', orderTotal: '83.28', customer: 'Example Beta' },
  { id: 'order-C', orderTotal: '452.8', customer: 'Example Gamma' },
];
const write = (name, value) => writeFile(`${here}${name}`, JSON.stringify(value, null, 2) + '\n');
const seed = { id: 'orders', name: 'Orders', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [0, 0], parameters: { mode: 'runOnceForAllItems', jsCode: 'return [];' } };
const numericKey = { id: 'numeric-key', name: 'Add numeric sort key', type: 'n8n-nodes-base.set', typeVersion: 3.4,
  position: [240, 0], parameters: { assignments: { assignments: [
    { id: 'amount-key', name: '_amountSortKey', value: '={{ Number($json.orderTotal) }}', type: 'number' },
  ] }, includeOtherFields: true, options: {} } };
const stripKey = { id: 'original-orders', name: 'Return original orders', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [720, 0], parameters: { mode: 'runOnceForAllItems', jsCode:
    'return $input.all().map(item => {\n  const { _amountSortKey, ...json } = item.json;\n  return { ...item, json };\n});' } };

for (const direction of ['descending', 'ascending']) {
  const order = direction === 'descending' ? [2, 0, 1] : [1, 0, 2];
  // Expected order is stated independently, not calculated by the tested sort.
  assert.deepEqual(order.map(index => input[index].id), direction === 'descending'
    ? ['order-C', 'order-A', 'order-B'] : ['order-B', 'order-A', 'order-C']);
  for (const variant of ['raw', 'fixed', 'numbers']) {
    const fixed = variant === 'fixed';
    const items = variant === 'numbers' ? input.map(row => ({ ...row, orderTotal: Number(row.orderTotal) })) : input;
    const sort = { id: `sort-${direction}`, name: 'Sort orders', type: 'n8n-nodes-base.sort', typeVersion: 1,
      position: [fixed ? 480 : 240, 0], parameters: { type: 'simple',
        sortFieldsUi: { sortField: [{ fieldName: fixed ? '_amountSortKey' : 'orderTotal', order: direction }] }, options: {} } };
    const nodes = fixed ? [seed, numericKey, sort, stripKey] : [seed, sort];
    const connections = Object.fromEntries(nodes.slice(0, -1).map((node, index) =>
      [node.name, { main: [[{ node: nodes[index + 1].name, type: 'main', index: 0 }]] }]));
    const source = { name: `${variant} amount sort: ${direction}`, active: false, nodes, connections,
      settings: { executionOrder: 'v1' } };
    const spec = { version: 1, name: `${variant} amounts: ${direction}, complete order rows`,
      input: { node: 'Orders', items }, mocks: [], assertions: [
        { node: nodes.at(-1).name, count: 3, equals: order.map(index => items[index]) },
      ] };
    await write(`${variant}-${direction}.slice.json`, source);
    await write(`${variant}-${direction}.case.json`, spec);
    await write(`${variant}-${direction}.editor-test.json`, editorTestWorkflow(source, spec));
    if (variant === 'raw' && direction === 'descending')
      await write('raw-descending.workflow.json', prepareWorkflow(source, spec, 'http://127.0.0.1:1').workflow);
  }
}
console.log('Built six local editor contracts and the ordinary string-sort workflow.');
