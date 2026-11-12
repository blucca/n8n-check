import { auditExecutions } from './core.mjs';

const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
let report;
const controls = ['files', 'wrong-example', 'good-example'];
function busy(value) { for (const id of controls) $(id).disabled = value; }
function status(message, error = false) {
  $('import-status').textContent = message;
  $('import-status').className = error ? 'error' : '';
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function address(c) {
  const line = element('span');
  line.append(element('strong', `${c.node} · item ${c.item}`),
    element('span', `Execution ${c.execution}, run ${c.run}, output ${c.output}`, 'coord-meta'));
  return line;
}
function addresses(rows) {
  const span = element('span');
  for (const c of rows) span.append(address(c));
  return span;
}
function render(value, names) {
  report = value;
  $('results').hidden = false;
  $('results').dataset.status = report.status;
  $('loaded-files').textContent = `Files: ${names.join(', ')}`;
  $('result-title').textContent = report.status === 'incomplete' ? 'Saved evidence is incomplete' :
    report.status === 'mismatch' ? `${report.mismatches} recorded links disagree` :
    `All ${report.checked_items} recorded links agree`;
  $('result-detail').textContent = report.status === 'incomplete' ? 'An ancestry result needs the complete supported call bundle.' :
    `${report.execution_count} executions, ${report.boundary_count} call boundaries, ${report.checked_items} returned items checked.`;
  $('incomplete').hidden = report.status !== 'incomplete';
  $('reason').textContent = report.reason ?? '';
  $('boundaries').replaceChildren();
  for (const boundary of report.boundaries ?? []) {
    const section = element('section', null, 'call-boundary');
    section.append(element('h3', `${boundary.node} · run ${boundary.run}`),
      element('p', `Parent execution ${boundary.parent_execution} calls child ${boundary.child_execution} in ${boundary.mode} mode.`, 'call-meta'));
    const table = element('table', null, 'comparison');
    const headers = ['Returned item', 'Child-derived source', 'Caller recorded source', 'Result'];
    const head = element('thead'), headings = element('tr');
    for (const label of headers) { const th = element('th', label); th.scope = 'col'; headings.append(th); }
    head.append(headings);
    const body = element('tbody');
    for (const finding of boundary.findings) {
      const row = element('tr');
      row.dataset.status = finding.status;
      const values = [address(finding.caller), addresses(finding.expected), addresses(finding.observed),
        element('span', finding.status === 'mismatch' ? 'Disagrees' : 'Agrees', 'result')];
      for (const [i, value] of values.entries()) {
        const cell = element('td'); cell.dataset.label = headers[i]; cell.append(value); row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body); section.append(table);
    const details = element('details');
    details.append(element('summary', 'Composed outer origins'),
      element('pre', pretty(boundary.findings.map(f => ({ returned_item: f.caller, outer_origins: f.roots })))));
    section.append(details); $('boundaries').append(section);
  }
  $('report').textContent = pretty(report);
}
async function load(readers) {
  busy(true);
  status('Reading saved files locally…');
  try {
    const entries = await Promise.all(readers.map(async entry => {
      const text = await entry.text();
      let execution;
      try { execution = JSON.parse(text); }
      catch { throw new Error(`${entry.name}: valid JSON is required.`); }
      // A collector folder includes an acquisition receipt alongside the API
      // records. Keep it out of the ancestry input; the core checks all calls.
      const receipt = execution?.status === 'complete' &&
        execution.parent_execution != null && Array.isArray(execution.executions) &&
        !execution.workflowData;
      if (execution?.nodes && !execution.workflowData) throw new Error(`${entry.name}: this is a workflow export. Choose a saved execution API response with includeData=true.`);
      return { name: entry.name, execution, receipt };
    }));
    const records = entries.filter(entry => !entry.receipt);
    if (!records.length) throw new Error('Choose the collector\'s execution-*.json files. The manifest is an acquisition receipt.');
    render(auditExecutions(records.map(entry => entry.execution)), records.map(entry => entry.name));
    const receipts = entries.length - records.length;
    status(`Saved files inspected.${receipts ? ` ${receipts} collector receipt(s) kept separate from execution data.` : ''} File contents remain in this tab.`);
  } catch (error) {
    render({ status: 'incomplete', reason: error.message }, readers.map(entry => entry.name));
    status(error.message, true);
  } finally { busy(false); }
}
$('files').addEventListener('change', event => {
  if (event.target.files.length) load([...event.target.files]);
});
function example(selection) {
  return load(['parent', 'bridge', 'leaf'].map(role => {
    const name = `nested-input${selection}-${role}-execution.json`;
    return { name, text: async () => {
      const response = await fetch(`../experiments/execution-graph/recorded/${name}`);
      if (!response.ok) throw new Error(`Example file ${name}: HTTP ${response.status}.`);
      return response.text();
    } };
  }));
}
$('wrong-example').addEventListener('click', () => example(2));
$('good-example').addEventListener('click', () => example(1));
$('clear').addEventListener('click', () => {
  report = undefined;
  $('files').value = '';
  $('results').hidden = true;
  $('boundaries').replaceChildren();
  $('report').textContent = '';
  $('loaded-files').textContent = '';
  status('Files cleared. Choose another saved call.');
  $('files').focus();
});
$('download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([pretty(report) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'n8n-saved-call-report.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
