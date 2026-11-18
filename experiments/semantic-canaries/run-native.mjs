import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { root, expectedIDs, expectedLeads } from './canaries.mjs';
import { prepareWorkflow } from './core/workflow.mjs';
import { runtimeEnv, command } from './core/runner.mjs';
import { executionFrom, executionChecks } from './core/report.mjs';

export function projectRows(rows, fields) {
  return rows.map((row, index) => Object.fromEntries(fields.map(field => {
    assert.ok(row && Object.hasOwn(row, field), `output item ${index} is missing declared field ${field}`);
    return [field, row[field]];
  })));
}

const occurrences = values => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => String(a).localeCompare(String(b)));
};

export function domainCheck(items, rows, contract) {
  const inputIDs = contract.family === 'leads' ? items.map(row => row.Email.toLowerCase()) : items.map(row => row.id);
  const domain = new Set(inputIDs), available = new Map(occurrences(inputIDs));
  const missingIdentityItems = [], outsideItems = [], actualIDs = [];
  rows.forEach((row, index) => {
    if (!row || !Object.hasOwn(row, contract.identityField)) { missingIdentityItems.push(index); return; }
    const id = row[contract.identityField]; actualIDs.push(id);
    if (!domain.has(id)) outsideItems.push({ index, identity: id });
  });
  const actualOccurrences = occurrences(actualIDs);
  return { passed: missingIdentityItems.length === 0 && outsideItems.length === 0,
    definition: contract.membershipDomain, inputIdentities: inputIDs, missingIdentityItems, outsideItems,
    inputOccurrences: [...available], actualOccurrences,
    occurrenceOverdrawDiagnostic: actualOccurrences.filter(([id, count]) => domain.has(id) && count > available.get(id))
      .map(([id, count]) => ({ identity: id, inputOccurrences: available.get(id), outputOccurrences: count })),
    occurrenceVerdictLocation: 'independent anchor; membership verdict checks identity range only' };
}

export function relationCheck(group, contract, baseRows, changedRows) {
  const allowed = group.transformation === 'rename' ? contract.renameAllowed : contract.sourceNoiseAllowed;
  if (!allowed) return { status: 'scope_required', consistent: null, transformation: group.transformation, reason: contract.scopeReason };
  try {
    const base = projectRows(baseRows, contract.fields), changed = projectRows(changedRows, contract.fields);
    const transported = group.transformation === 'rename'
      ? base.map(row => ({ ...row, [contract.identityField]: Object.hasOwn(group.identityMap, row[contract.identityField])
        ? group.identityMap[row[contract.identityField]] : row[contract.identityField] })) : base;
    const consistent = isDeepStrictEqual(transported, changed);
    return { status: consistent ? 'consistent' : 'inconsistent', consistent, transformation: group.transformation,
      fields: contract.fields, transportedBaseProjection: transported, changedProjection: changed };
  } catch (error) { return { status: 'inconsistent', consistent: false, transformation: group.transformation, missingFieldError: error.message }; }
}

export async function verifyManifest() {
  const manifest = JSON.parse(await readFile(join(root, 'source-manifest.json'), 'utf8'));
  assert.equal(manifest.plannedExecutions, 20);
  for (const entry of manifest.files) {
    const hash = createHash('sha256').update(await readFile(join(root, entry.file))).digest('hex');
    assert.equal(hash, entry.sha256, `Frozen artifact changed: ${entry.file}`);
  }
  return manifest;
}

const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function runNative(binary, out = join(root, 'native')) {
  const manifest = await verifyManifest();
  const plan = JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'));
  const contracts = JSON.parse(await readFile(join(root, 'contracts.json'), 'utf8'));
  assert.equal(plan.runs.length, 20, 'Only the frozen twenty workflow executions may run');
  await mkdir(out, { recursive: true });
  let attemptedExecutions = 0, completedExecutions = 0, n8nVersion;
  const results = [], pairResults = [];
  const state = async (status, extra = {}) => save(join(out, 'state.json'), {
    status, attemptedExecutions, completedExecutions, plannedExecutions: plan.plannedExecutions, n8nVersion,
    providerCalls: 0, httpNodesInDevelopmentSlice: 0, additionalExecutions: 0, ...extra,
  });
  await state('preparing');
  try {
    const home = await mkdtemp(join(out, 'home-')); await mkdir(join(home, 'tmp'));
    const env = { ...runtimeEnv(home), NODE_OPTIONS: '--max-old-space-size=512' };
    const prepared = [];
    for (const run of plan.runs) {
      const spec = JSON.parse(await readFile(join(root, run.caseFile), 'utf8'));
      const source = JSON.parse(await readFile(join(root, run.workflowFile), 'utf8'));
      const items = JSON.parse(await readFile(join(root, run.businessInputFile), 'utf8'));
      const contract = contracts[run.contractKey];
      const expected = contract.family === 'leads' ? expectedLeads(items) : expectedIDs(items, contract);
      assert.deepEqual(run.expectedProjection, expected, `${run.label}: independent generator differs from frozen answer`);
      for (const field of contract.fields) assert.deepEqual(spec.assertions.find(a => a.node === run.output && a.pluck === `json.${field}`).equals, expected.map(row => row[field]));
      const prep = prepareWorkflow(source, spec, 'http://127.0.0.1:1');
      prepared.push({ run, spec, items, contract, expected, prep });
    }
    await save(join(out, 'workflows.json'), prepared.map(p => p.prep.workflow));
    await save(join(out, 'preparation.json'), prepared.map(p => ({ label: p.run.label, ...p.prep, workflow: undefined })));
    await save(join(out, 'manifest-used.json'), manifest);
    const version = await command(binary, ['--version'], env, 60000); await save(join(out, 'version.command.json'), version);
    assert.equal(version.exitCode, 0, version.error || version.stderr || version.stdout); assert.ok(!version.error);
    n8nVersion = version.stdout.trim();
    const imported = await command(binary, ['import:workflow', `--input=${join(out, 'workflows.json')}`], env, 60000);
    await save(join(out, 'import.command.json'), imported);
    assert.equal(imported.exitCode, 0, imported.error || imported.stderr || imported.stdout); assert.ok(!imported.error);
    await state('running');
    for (const p of prepared) {
      attemptedExecutions++;
      const executed = await command(binary, ['execute', `--id=${p.prep.workflow.id}`, '--rawOutput'], env, p.spec.timeoutMs);
      await save(join(out, `${p.run.label}.command.json`), executed);
      const execution = executionFrom(`${executed.stdout}\n${executed.stderr}`);
      if (execution) await save(join(out, `${p.run.label}.execution.json`), execution);
      const checks = executionChecks(execution, executed, p.spec.assertions);
      assert.ok(checks[0].passed, `${p.run.label}: engine failure: ${JSON.stringify(checks[0].actual)}`);
      const data = execution.data.resultData.runData;
      const outputs = Object.fromEntries(Object.entries(data).map(([name, entries]) => [name, {
        main: Array.from({ length: Math.max(0, ...entries.map(entry => entry.data?.main?.length ?? 0)) }, (_, port) =>
          entries.flatMap(entry => entry.data?.main?.[port] ?? []).map(item => item.json)),
      }]));
      await save(join(out, `${p.run.label}.outputs.json`), outputs);
      const rows = outputs[p.run.output]?.main?.[0] ?? [];
      const domain = domainCheck(p.items, rows, p.contract);
      const anchorChecks = checks.slice(1);
      const actualIDs = rows.filter(row => row && Object.hasOwn(row, p.contract.identityField)).map(row => row[p.contract.identityField]);
      const expectedIDs = p.expected.map(row => row[p.contract.identityField]);
      const orderedFieldChecks = anchorChecks.filter(check => check.name.startsWith(`${p.run.output}: output 0 pluck `));
      const anchor = { passed: anchorChecks.every(check => check.passed), countPassed: rows.length === p.expected.length,
        orderedProjectionPassed: orderedFieldChecks.every(check => check.passed),
        identityMultiplicityPassed: isDeepStrictEqual(occurrences(actualIDs), occurrences(expectedIDs)),
        expectedOccurrences: occurrences(expectedIDs), actualOccurrences: occurrences(actualIDs),
        expectedProjection: p.expected, checks: anchorChecks,
        generatedFrom: { businessInputFile: p.run.businessInputFile, contract: p.contract.id } };
      const result = { label: p.run.label, group: p.run.group, side: p.run.side, output: p.run.output,
        engine: checks[0], actualRows: rows, executedNodes: Object.keys(data), domain, anchor };
      results.push(result); completedExecutions++;
      const group = plan.groups.find(group => group.id === p.run.group);
      if (p.run.side === 'changed') {
        const [base, changed] = results.filter(result => result.group === group.id);
        const relation = relationCheck(group, p.contract, base.actualRows, changed.actualRows);
        const anticipatedChecks = {
          anchors: isDeepStrictEqual([base.anchor.passed, changed.anchor.passed], group.anticipated.anchorPassed),
          memberships: isDeepStrictEqual([base.domain.passed, changed.domain.passed], group.anticipated.membershipPassed),
          relation: relation.status === group.anticipated.relationStatus,
        };
        pairResults.push({ group: group.id, contract: p.contract.id, relation,
          domain: { base: base.domain, changed: changed.domain }, anchor: { base: base.anchor, changed: changed.anchor },
          anticipated: group.anticipated, anticipatedChecks,
          interpretation: group.id.startsWith('H-') ? 'new-input lawful holdout migration; no new defect claim' : group.id.startsWith('L-') ? 'lawful business semantics; metamorphic scope closed in advance' : 'development control' });
        console.log(JSON.stringify({ group: group.id, relation: relation.status,
          membership: [base.domain.passed, changed.domain.passed], anchor: [base.anchor.passed, changed.anchor.passed] }));
        await save(join(out, 'results.json'), { n8nVersion, attemptedExecutions, completedExecutions, plannedExecutions: 20,
          expectedFromOldOutputs: false, pairs: pairResults, runs: results });
        await state('running', { last: p.run.label });
        if (!Object.values(anticipatedChecks).every(Boolean)) {
          throw new Error(`${group.id}: frozen hypothesis failed; preserve result and stop without extending or repairing the matrix`);
        }
      } else await state('running', { last: p.run.label });
    }
    await state('complete', { groups: pairResults.length, allAnticipatedClassificationsObserved: true });
    return { n8nVersion, attemptedExecutions, completedExecutions, pairs: pairResults };
  } catch (error) {
    await save(join(out, 'results.json'), { n8nVersion, attemptedExecutions, completedExecutions, plannedExecutions: 20, pairs: pairResults, runs: results, stoppedReason: error.message });
    await state('stopped', { reason: error.message });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'After root freeze: node run-native.mjs /absolute/path/to/existing/n8n [output-directory]');
  await runNative(resolve(process.argv[2]), resolve(process.argv[3] ?? join(root, 'native')));
}
