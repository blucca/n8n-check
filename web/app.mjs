import { inspectWorkflow, draftCase } from '../src/case-draft.mjs';
import { buildLocalBundle } from '../src/local-bundle.mjs';

const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
let source, inspection, plan, originalText, isExample = false;
const editors = ['input-items', 'expected-items', 'mocks'];
let expectationDrafts = {}, previousMode = 'exact';
const nineRowDetail = $('example-detail').innerHTML;
const boundary = () => $('stop-after').checked ? { stopAfter: $('assert-node').value } : {};

function importStatus(message, error = false) {
  $('import-status').textContent = message;
  $('import-status').className = error ? 'error' : '';
}
function optionsFor(select, nodes, value) {
  select.replaceChildren(...nodes.map(node => {
    const option = document.createElement('option');
    option.value = node.name;
    option.textContent = `${node.name}${node.hasPinData ? ` · ${node.pinItemCount} pinned` : ''}`;
    return option;
  }));
  select.value = value;
}
function editorValue(id, name) {
  try { return JSON.parse($(id).value); }
  catch { throw new Error(`${name}: enter valid JSON. Arrays use square brackets and property names use double quotes.`); }
}
function assertionOptions() {
  const assertionMode = $('assertion-mode').value;
  const count = $('expected-count').value;
  return {
    assertionMode,
    ...(assertionMode === 'exact' ? { expectedItems: editorValue('expected-items', 'Expected output') } : {}),
    ...(assertionMode === 'pluck' ? { pluck: $('pluck-path').value, expectedValues: editorValue('expected-items', 'Expected field values') } : {}),
    ...(assertionMode !== 'exact' ? { expectedCount: count === '' ? null : Number(count) } : {}),
  };
}
function showAssertionMode() {
  const mode = $('assertion-mode').value;
  $('pluck-control').hidden = mode !== 'pluck';
  $('count-control').hidden = mode === 'exact';
  $('expected-editor').hidden = mode === 'count';
  $('assertion-help').textContent = {
    exact: 'Compare every JSON field in execution order.',
    pluck: 'Preserve business IDs or another stable field while timestamps and other metadata change.',
    count: 'Check output volume. Use a selected field check when row identity matters.',
  }[mode];
  $('expected-help').textContent = mode === 'exact' ? 'Exact JSON items in run order. An empty array checks for zero items. Pins prefill branch 0.' : mode === 'pluck' ? 'An array of field values, e.g. ["row-A", "row-B"]. Order and duplicates are checked. Pins prefill branch 0.' : 'Zero checks for an empty output branch. Pins prefill branch 0.';
}
function seedExpectation() {
  const next = draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value, output: Number($('output').value), assertionMode: $('assertion-mode').value, pluck: $('pluck-path').value, ...boundary() });
  const assertion = next.spec.assertions[0];
  $('expected-items').value = pretty(assertion.equals ?? null);
  $('expected-count').value = assertion.count ?? '';
  const pending = $('assertion-mode').value === 'count' ? assertion.count == null : assertion.equals == null;
  $('expected-origin').textContent = pending ? 'Enter the expected values' : 'Prefilled from exported pins';
  showAssertionMode();
}
function seedEditors() {
  const next = draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value, output: Number($('output').value), name: $('case-name').value, ...boundary() });
  $('input-items').value = pretty(next.spec.input.items);
  expectationDrafts = {};
  seedExpectation();
  $('mocks').value = pretty(next.spec.mocks);
  $('input-origin').textContent = next.spec.input.items === null ? 'Enter your fixture JSON' : 'Prefilled from exported pins';
  $('mock-section').open = next.summary.httpNodes.length > 0;
  update();
}
function showIssues(issues) {
  $('issues').replaceChildren(...issues.map(issue => {
    const item = document.createElement('li'); item.textContent = issue.path ? `${issue.path}: ${issue.message}` : issue.message; return item;
  }));
}
function update() {
  try {
    const output = Number($('output').value);
    if ($('output').value === '' || !Number.isInteger(output) || output < 0) throw new Error('Output branch: enter a whole number starting at 0.');
    plan = draftCase(source, {
      inputNode: $('input-node').value, assertNode: $('assert-node').value, output,
      inputItems: editorValue('input-items', 'Input items'), ...assertionOptions(),
      mocks: editorValue('mocks', 'Mocks'), name: $('case-name').value, ...boundary(),
    });
    $('readiness-title').textContent = plan.ready ? 'Ready for a runtime check.' : 'Finish the case draft.';
    $('readiness-detail').textContent = plan.ready ? 'Fixture values, HTTP contracts, and the selected slice pass preparation checks. Review the expected behavior, then run it.' : `${plan.issues.length} preparation item${plan.issues.length === 1 ? '' : 's'} to resolve before running.`;
    showIssues(plan.issues);
    $('slice-nodes').textContent = plan.summary.keptNodes.join(' · ') || 'Select a fixture boundary.';
    $('omitted-title').textContent = `${plan.summary.omittedNodes.length} omitted nodes`;
    $('omitted-nodes').textContent = plan.summary.omittedNodes.join(', ');
    $('omitted-section').hidden = plan.summary.omittedNodes.length === 0;
    $('mock-count').textContent = `(${plan.summary.httpNodes.length} HTTP nodes)`;
    $('preview').textContent = pretty(plan.spec);
    $('download-case').textContent = plan.ready ? 'Download case.json' : 'Download draft JSON';
    $('download-case').disabled = false;
    $('download-ci').disabled = $('download-bundle').disabled = !plan.ready;
    $('bundle-status').textContent = '';
    document.querySelector('.readiness').classList.toggle('ready', plan.ready);
    document.querySelector('.readiness').classList.toggle('pending', !plan.ready);
  } catch (error) {
    plan = null;
    $('readiness-title').textContent = 'Check the JSON fields.';
    $('readiness-detail').textContent = 'Fix the field below to refresh the draft.';
    showIssues([{ message: error.message }]);
    $('preview').textContent = '';
    $('download-case').disabled = $('download-ci').disabled = $('download-bundle').disabled = true;
    $('bundle-status').textContent = '';
    document.querySelector('.readiness').classList.remove('ready');
    document.querySelector('.readiness').classList.add('pending');
  }
}
function load(text, label, example = false) {
  const parsed = JSON.parse(text);
  const checked = inspectWorkflow(parsed);
  source = parsed; inspection = checked; originalText = text; isExample = example;
  const workflow = Array.isArray(source) ? source[0] : source;
  $('workflow-name').textContent = workflow.name || label;
  $('node-count').textContent = `${checked.nodes.length} nodes`;
  const nodes = checked.nodes.filter(node => node.type !== 'n8n-nodes-base.stickyNote');
  optionsFor($('input-node'), nodes, checked.suggestedInputNode);
  const initial = draftCase(source, { inputNode: checked.suggestedInputNode });
  optionsFor($('assert-node'), nodes.filter(node => initial.summary.keptNodes.includes(node.name) && node.name !== checked.suggestedInputNode), initial.summary.assertNode);
  $('case-name').value = `${workflow.name || 'Workflow'} check`;
  $('output').value = '0';
  $('stop-after').checked = false;
  $('assertion-mode').value = previousMode = 'exact';
  $('pluck-path').value = 'json.id';
  $('builder').hidden = false;
  $('example-detail').hidden = !isExample;
  seedEditors();
  importStatus(`${label} loaded locally. Choose the boundary and review the expected items.`);
}
function download(name, contents, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof contents === 'string' && !contents.endsWith('\n') ? contents + '\n' : contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try { load(await file.text(), file.name); }
  catch (error) { $('builder').hidden = true; importStatus(`Import: ${error.message}`, true); }
  event.target.value = '';
});
$('load-paste').addEventListener('click', () => {
  try { load($('source').value, 'Pasted workflow'); }
  catch (error) { $('builder').hidden = true; importStatus(`Import: ${error.message}`, true); }
});
$('example').addEventListener('click', async () => {
  $('example').disabled = true;
  try {
    const get = async path => { const response = await fetch(path); if (!response.ok) throw new Error(`Example file returned HTTP ${response.status}`); return response.json(); };
    const [workflow, spec] = await Promise.all([get('examples/silent-filter/fixed.json'), get('examples/silent-filter/case.json')]);
    workflow.pinData = { [spec.input.node]: spec.input.items.map(json => ({ json })), ...Object.fromEntries(spec.assertions.map(assertion => [assertion.node, assertion.equals.map(json => ({ json }))])) };
    load(pretty(workflow), 'Synthetic nine-row example', true);
    $('example-detail').innerHTML = nineRowDetail;
    $('builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { importStatus(error.message, true); }
  finally { $('example').disabled = false; }
});
$('identity-example').addEventListener('click', async () => {
  $('identity-example').disabled = true;
  try {
    const get = async path => { const response = await fetch(path); if (!response.ok) throw new Error(`Example file returned HTTP ${response.status}`); return response.json(); };
    const [workflow, spec] = await Promise.all([get('examples/identity-projection/workflow.json'), get('examples/identity-projection/case.json')]);
    workflow.pinData = {
      [spec.input.node]: spec.input.items.map(json => ({ json })),
      'Select rows': spec.assertions[0].equals.map(id => ({ json: { ...spec.input.items.find(item => item.id === id), processedAt: '2026-10-07T00:00:00.000Z' } })),
    };
    load(pretty(workflow), 'Synthetic stable-ID example');
    $('assertion-mode').value = previousMode = 'pluck';
    seedExpectation(); update();
    $('example-detail').hidden = false;
    $('example-detail').textContent = 'This sample uses illustrative pinned snapshots. Each real run creates fresh timestamps. The selected-field contract preserves row-A and row-B in order. Try examples/identity-projection/wrong-id.json with the same case: it returns two rows with wrong IDs, and the identity check fails.';
    $('builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { importStatus(error.message, true); }
  finally { $('identity-example').disabled = false; }
});
$('input-node').addEventListener('change', () => {
  const next = draftCase(source, { inputNode: $('input-node').value });
  optionsFor($('assert-node'), inspection.nodes.filter(node => next.summary.keptNodes.includes(node.name) && node.name !== $('input-node').value && node.type !== 'n8n-nodes-base.stickyNote'), next.summary.assertNode);
  $('output').value = '0';
  seedEditors();
});
$('assert-node').addEventListener('change', () => {
  $('output').value = '0';
  const next = draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value, ...boundary() });
  expectationDrafts = {};
  seedExpectation();
  refreshMocks(next);
  update();
});
$('stop-after').addEventListener('change', () => {
  refreshMocks(draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value, ...boundary() }));
  update();
});
function refreshMocks(next) {
  // Retain authored contracts for kept HTTP nodes; add drafts when a boundary is expanded.
  let current;
  try { current = JSON.parse($('mocks').value); } catch { return; }
  if (!Array.isArray(current)) return;
  const byNode = new Map(current.map(mock => [mock?.node, mock]));
  $('mocks').value = pretty(next.spec.mocks.map(mock => byNode.get(mock.node) ?? mock));
  $('mock-section').open = next.summary.httpNodes.length > 0;
}
$('output').addEventListener('input', () => {
  expectationDrafts = {};
  seedExpectation();
  update();
});
$('assertion-mode').addEventListener('change', () => {
  expectationDrafts[previousMode] = { values: $('expected-items').value, count: $('expected-count').value, origin: $('expected-origin').textContent };
  const mode = $('assertion-mode').value;
  if (expectationDrafts[mode]) {
    const saved = expectationDrafts[mode];
    $('expected-items').value = saved.values;
    $('expected-count').value = saved.count;
    $('expected-origin').textContent = saved.origin;
    showAssertionMode();
  } else seedExpectation();
  previousMode = mode;
  update();
});
$('pluck-path').addEventListener('input', () => {
  seedExpectation();
  update();
});
$('expected-count').addEventListener('input', update);
for (const id of [...editors, 'case-name']) $(id).addEventListener('input', () => {
  if (id === 'input-items') $('input-origin').textContent = 'Edited fixture';
  if (id === 'expected-items') $('expected-origin').textContent = 'Edited expectation';
  update();
});
$('download-case').addEventListener('click', () => { if (plan) download(plan.ready ? 'case.json' : 'case.draft.json', pretty(plan.spec)); });
$('download-workflow').addEventListener('click', () => download('workflow.json', originalText));
$('download-ci').addEventListener('click', () => { if (plan?.ready && $('runtime-version').reportValidity()) download('n8n-check.yml', `name: n8n release check
on: [push, pull_request, workflow_dispatch]
permissions:
  contents: read
jobs:
  regression:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: blucca/n8n-check@v0.1.6
        with:
          n8n-version: '${$('runtime-version').value}'
          workflow: workflow.json
          case: case.json
          out: results/check
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: n8n-check-results
          path: |
            results/check/report.json
            results/check/junit.xml
`, 'text/yaml'); });

$('download-bundle').addEventListener('click', () => {
  if (!plan?.ready || !$('runtime-version').reportValidity()) return;
  try {
    const zip = buildLocalBundle({ workflow: source, caseFile: plan.spec, n8nVersion: $('runtime-version').value });
    download('n8n-check-local.zip', zip, 'application/zip');
    $('bundle-status').textContent = 'Unzip the pack, open a terminal in its folder, and run sh run.sh. Results appear in results/report.json and results/junit.xml.';
  } catch (error) { $('bundle-status').textContent = error.message; }
});
