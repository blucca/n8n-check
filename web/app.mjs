import { inspectWorkflow, draftCase } from '../src/case-draft.mjs';

const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
let source, inspection, plan, originalText, isExample = false;
const editors = ['input-items', 'expected-items', 'mocks'];

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
function seedEditors() {
  const next = draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value, output: Number($('output').value), name: $('case-name').value });
  $('input-items').value = pretty(next.spec.input.items);
  $('expected-items').value = pretty(next.spec.assertions[0].equals);
  $('mocks').value = pretty(next.spec.mocks);
  $('input-origin').textContent = next.spec.input.items === null ? 'Enter your fixture JSON' : 'Prefilled from exported pins';
  $('expected-origin').textContent = next.spec.assertions[0].equals === null ? 'Enter the expected JSON items' : 'Prefilled from exported pins';
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
      inputItems: editorValue('input-items', 'Input items'), expectedItems: editorValue('expected-items', 'Expected output'),
      mocks: editorValue('mocks', 'Mocks'), name: $('case-name').value,
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
    $('download-ci').disabled = !plan.ready;
    document.querySelector('.readiness').classList.toggle('ready', plan.ready);
    document.querySelector('.readiness').classList.toggle('pending', !plan.ready);
  } catch (error) {
    plan = null;
    $('readiness-title').textContent = 'Check the JSON fields.';
    $('readiness-detail').textContent = 'Fix the field below to refresh the draft.';
    showIssues([{ message: error.message }]);
    $('preview').textContent = '';
    $('download-case').disabled = $('download-ci').disabled = true;
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
  $('case-name').value = `${workflow.name || 'Workflow'} regression`;
  $('output').value = '0';
  $('builder').hidden = false;
  $('example-detail').hidden = !isExample;
  seedEditors();
  importStatus(`${label} loaded locally. Choose the boundary and review the expected items.`);
}
function download(name, contents, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents.endsWith('\n') ? contents : contents + '\n'], { type }));
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
    $('builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { importStatus(error.message, true); }
  finally { $('example').disabled = false; }
});
$('input-node').addEventListener('change', () => {
  const next = draftCase(source, { inputNode: $('input-node').value });
  optionsFor($('assert-node'), inspection.nodes.filter(node => next.summary.keptNodes.includes(node.name) && node.name !== $('input-node').value && node.type !== 'n8n-nodes-base.stickyNote'), next.summary.assertNode);
  $('output').value = '0';
  seedEditors();
});
$('assert-node').addEventListener('change', () => {
  $('output').value = '0';
  const next = draftCase(source, { inputNode: $('input-node').value, assertNode: $('assert-node').value });
  $('expected-items').value = pretty(next.spec.assertions[0].equals);
  $('expected-origin').textContent = next.spec.assertions[0].equals === null ? 'Enter the expected JSON items' : 'Prefilled from exported pins';
  update();
});
$('output').addEventListener('input', () => {
  $('expected-items').value = 'null';
  $('expected-origin').textContent = 'Enter expected items for this branch';
  update();
});
for (const id of [...editors, 'case-name']) $(id).addEventListener('input', () => {
  if (id === 'input-items') $('input-origin').textContent = 'Edited fixture';
  if (id === 'expected-items') $('expected-origin').textContent = 'Edited expectation';
  update();
});
$('download-case').addEventListener('click', () => { if (plan) download(plan.ready ? 'case.json' : 'case.draft.json', pretty(plan.spec)); });
$('download-workflow').addEventListener('click', () => download('workflow.json', originalText));
$('download-ci').addEventListener('click', () => { if (plan?.ready) download('n8n-check.yml', `name: n8n release check
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
      - uses: blucca/n8n-check@v0.1.3
        with:
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
