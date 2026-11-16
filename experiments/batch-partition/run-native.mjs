import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { prepareWorkflow } from '../../src/workflow.mjs';
import { runtimeEnv, command } from '../../src/runner.mjs';
import { executionFrom } from '../../src/report.mjs';
import { compareRows } from './compare.mjs';

const root = resolve(process.argv[2] ?? '.');
const binary = resolve(process.argv[3]);
const out = join(root, 'native');
await mkdir(out, { recursive: true });
const controls = JSON.parse(await readFile(new URL('./controls.json', import.meta.url), 'utf8'));
const home = await mkdtemp(join(out, 'home-'));
await mkdir(join(home, 'tmp'));
const env = { ...runtimeEnv(home), NODE_OPTIONS: '--max-old-space-size=512' };
const version = await command(binary, ['--version'], env, 60000);
assert.equal(version.exitCode, 0, version.stderr || version.stdout);
const n8nVersion = version.stdout.trim();
const prepared = [];
for (const control of controls) {
  const partitions = [control.items, ...control.items.map(row => [row])];
  for (let i = 0; i < partitions.length; i++) {
    // count:0 solely satisfies the existing slice-preparation schema. This
    // observer never runs executionChecks or judges that placeholder value.
    const spec = { version: 1, name: `${control.name}/${i === 0 ? 'batch' : `item-${i}`}`,
      input: { node: control.input, items: partitions[i] }, stopAfter: control.output,
      mocks: [], assertions: [{ node: control.output, count: 0 }] };
    const workflow = prepareWorkflow(control.workflow, spec, 'http://127.0.0.1:1').workflow;
    prepared.push({ control, index: i, workflow });
  }
}
const workflowFile = join(out, 'workflows.json');
await writeFile(workflowFile, JSON.stringify(prepared.map(p => p.workflow), null, 2) + '\n');
const imported = await command(binary, ['import:workflow', `--input=${workflowFile}`], env, 60000);
await writeFile(join(out, 'import.json'), JSON.stringify(imported, null, 2));
assert.equal(imported.exitCode, 0, imported.stderr || imported.stdout);
const runs = new Map(), results = [];
let completedExecutions = 0;
for (const p of prepared) {
  const label = `${p.control.name}-${p.index}`;
  const executed = await command(binary, ['execute', `--id=${p.workflow.id}`, '--rawOutput'], env, 60000);
  await writeFile(join(out, `${label}.command.json`), JSON.stringify(executed, null, 2));
  const execution = executionFrom(executed.stdout + '\n' + executed.stderr);
  assert.equal(executed.exitCode, 0, `${label}: ${executed.stderr || executed.stdout}`);
  assert.ok(execution && !execution.data.resultData.error, `${label}: complete successful execution required`);
  await writeFile(join(out, `${label}.execution.json`), JSON.stringify(execution, null, 2));
  const data = execution.data.resultData.runData;
  const observed = Object.fromEntries(Object.entries(data).map(([name, entries]) => [name,
    entries.flatMap(run => run.data?.main?.[0] ?? []).map(item => item.json)]));
  if (!runs.has(p.control.name)) runs.set(p.control.name, []);
  runs.get(p.control.name).push({ observed, order: Object.keys(data) });
  completedExecutions++;
  await writeFile(join(out, 'state.json'), JSON.stringify({ status: 'running', n8nVersion,
    completedExecutions, plannedExecutions: prepared.length, last: label }, null, 2));
  if (p.index !== p.control.items.length) continue;
  const [batch, ...parts] = runs.get(p.control.name);
  const relation = compareRows(batch.observed[p.control.output] ?? [], parts.map(r => r.observed[p.control.output] ?? []), p.control.fields);
  const divergence = relation.consistent ? null : batch.order.filter(name => name !== p.workflow.nodes[0].name).map(node => ({
    node, ...compareRows(batch.observed[node] ?? [], parts.map(r => r.observed[node] ?? []), node === p.control.output ? p.control.fields : undefined),
  })).find(r => !r.consistent) ?? null;
  const result = { name: p.control.name, input: p.control.input, output: p.control.output,
    semanticContract: p.control.semanticContract, relation,
    status: p.control.semanticContract === 'independent-records'
      ? relation.consistent ? 'partition_consistent' : 'partition_sensitive' : 'scope_required',
    firstObservedDivergence: divergence, witnessInputs: relation.consistent ? null : p.control.items,
    witnessRecordCount: relation.consistent ? null : p.control.items.length,
    knownControl: p.control.knownControl };
  assert.equal(result.status, p.control.expectedStatus, `${p.control.name}: relation classification differs`);
  if (p.control.expectedRelation !== undefined) assert.equal(relation.consistent, p.control.expectedRelation);
  if (p.control.expectedDivergence) assert.equal(divergence?.node, p.control.expectedDivergence);
  results.push(result);
  await writeFile(join(out, 'results.json'), JSON.stringify({ n8nVersion, providerCalls: 0,
    businessExpectedUsedByRelation: false, completedExecutions, results }, null, 2));
  console.log(JSON.stringify({ name: result.name, status: result.status, batch: relation.batchCount,
    partitions: relation.partitionCount, firstNode: divergence?.node ?? null }));
}
await writeFile(join(out, 'state.json'), JSON.stringify({ status: 'complete', n8nVersion,
  completedExecutions, plannedExecutions: prepared.length, controls: results.length, allChecksPassed: true }, null, 2));
console.log(JSON.stringify({ complete: true, controls: results.length, completedExecutions, n8nVersion }));
