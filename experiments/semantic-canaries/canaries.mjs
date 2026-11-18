import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = dirname(fileURLToPath(import.meta.url));
export const seeds = { development: 0x664d2026, holdout: 0x664a1120 };

// Independent synthetic business rule, frozen before any new execution.
export const scoreEligible = row => typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0.7;

export function expectedIDs(items, contract = {}) {
  return items.filter(row => scoreEligible(row)
    && (!contract.literalWhitelist || contract.literalWhitelist.includes(row.id))
    && (!contract.currentSourceOnly || row.source === 'current-index'))
    .map(row => ({ id: row.id }));
}

// README-backed restricted family: valid business emails and already-canonical
// plain Full Name values. This is not the workflow's normalization implementation.
export function expectedLeads(items) {
  const seen = new Set(), out = [];
  for (const row of items) {
    const email = row.Email.toLowerCase();
    const [local, domain] = email.split('@');
    const mailbox = `${local.split('+')[0]}@${domain}`;
    if (seen.has(mailbox)) continue;
    seen.add(mailbox);
    out.push({ email, full_name: row['Full Name'] });
  }
  return out;
}

function randomHex(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0).toString(16).padStart(8, '0');
  };
}

export function generateFixtures() {
  const random = randomHex(seeds.development);
  const freshPair = family => {
    const base = Array.from({ length: 4 }, (_, i) => `r664-${family}-b-${i}-${random()}`);
    const renamed = Array.from({ length: 4 }, (_, i) => `r664-${family}-r-${i}-${random()}`);
    const items = [0.699, 0.700, 0.701, 0.930].map((score, i) => ({ id: base[i], score, marker: `diagnostic-${i}` }));
    items.push(structuredClone(items[1]));
    const map = Object.fromEntries(base.map((id, i) => [id, renamed[i]]));
    return { base: items, changed: items.map(row => ({ ...row, id: map[row.id] })), identityMap: map };
  };
  const score = freshPair('score');
  const silentIDs = freshPair('silent');
  const silent = {
    base: silentIDs.base.map(row => ({ ...row, source: 'current-index' })),
    changed: silentIDs.base.map(row => ({ ...row, source: 'legacy-index' })),
    identityMap: {},
  };
  const hRandom = randomHex(seeds.holdout);
  const baseLocal = Array.from({ length: 4 }, (_, i) => `canary${i}${hRandom()}`);
  const aliasLocal = Array.from({ length: 4 }, (_, i) => `alias${i}${hRandom()}`);
  // First-appearance order intentionally differs from local-part index order.
  const rows = [
    [2, 'first', 'Evelyn Park', true], [0, 'first', 'Nico Reed', false],
    [2, 'repeat', 'Casey Fox', false], [3, 'first', 'Mila Hart', false],
    [1, 'first', 'Owen Dale', true], [3, 'repeat', 'Theo Lane', true],
  ];
  const leads = localParts => rows.map(([group, tag, name, uppercase]) => {
    const email = `${localParts[group]}+${tag}@canary.example.org`;
    return { 'Full Name': name, Email: uppercase ? email.toUpperCase() : email, Company: 'Canary Works' };
  });
  const holdout = { base: leads(baseLocal), changed: leads(aliasLocal) };
  holdout.identityMap = Object.fromEntries(holdout.base.map((row, i) => [row.Email.toLowerCase(), holdout.changed[i].Email.toLowerCase()]));
  return { score, silent, holdout };
}

export function contractsFor(fixtures) {
  return {
    score: {
      id: 'independent-score-copy', family: 'ids', identityField: 'id', fields: ['id'],
      rule: 'one output per input occurrence with numeric score >= 0.7; preserve its id and input order',
      multiplicity: 'one per eligible input occurrence; duplicates remain duplicates',
      membershipDomain: 'all input id values, including ineligible records',
      ignoredOutputFields: ['processedAt', 'marker', 'source'],
      renameAllowed: true, sourceNoiseAllowed: true,
      attribution: 'our independent synthetic acceptance contract; no external owner authorization',
      evidence: ['sources/identity-projection.README.md', 'sources/silent-filter.README.md'],
    },
    silent: {
      id: 'independent-score-with-diagnostic-source', family: 'ids', identityField: 'id', fields: ['id'],
      rule: 'one output per numeric score >= 0.7, independent of source label; preserve id, duplicates and order',
      multiplicity: 'one per eligible input occurrence', membershipDomain: 'all input id values',
      ignoredOutputFields: ['source', 'marker', 'processedAt'], renameAllowed: true, sourceNoiseAllowed: true,
      sourceRole: 'diagnostic label declared by this synthetic contract',
      attribution: 'our synthetic reconstruction; source-is-diagnostic is our new declaration, not a real user authorization',
      evidence: ['sources/silent-filter.README.md'],
    },
    holdout: {
      id: 'relaybrook-valid-mailbox-first-row', family: 'leads', identityField: 'email', fields: ['email', 'full_name'],
      rule: 'lowercase valid email; same mailbox ignores case and +tags; first row wins; preserve first-appearance order and its canonical Full Name',
      multiplicity: 'one output per mailbox equivalence class',
      membershipDomain: 'lowercased Email values from all input rows, before mailbox deduplication',
      fixtureScope: 'valid business emails at a fixed canary.example.org domain; simple already-canonical ASCII names; no titles, padding, Anna, Gmail, lookup or sorting',
      ignoredOutputFields: ['source_row', 'fixes', 'issues', 'dedupe_key', 'other_emails', 'company_domain', 'email_type', 'merged_rows'],
      renameAllowed: true, sourceNoiseAllowed: false,
      attribution: 'original Relaybrook README business semantics; our new synthetic input family, not owner adoption or a new bug discovery',
      evidence: ['sources/relaybrook.README.md'],
    },
    whitelist: {
      id: 'legal-literal-id-whitelist', family: 'ids', identityField: 'id', fields: ['id'],
      rule: 'numeric score >= 0.7 AND id in the frozen literal whitelist; preserve id, duplicates and input order',
      literalWhitelist: [fixtures.score.base[1].id],
      multiplicity: 'one per eligible occurrence', membershipDomain: 'all input id values',
      ignoredOutputFields: ['processedAt', 'marker'], renameAllowed: false, sourceNoiseAllowed: true,
      scopeReason: 'literal identity values participate in the business whitelist; rename is outside this contract',
      attribution: 'our independent synthetic lawful semantic counterexample', evidence: [],
    },
    currentOnly: {
      id: 'legal-current-source-only', family: 'ids', identityField: 'id', fields: ['id'],
      rule: 'numeric score >= 0.7 AND source is current-index; preserve id, duplicates and input order',
      currentSourceOnly: true, sourceRole: 'business selector',
      multiplicity: 'one per eligible occurrence', membershipDomain: 'all input id values',
      ignoredOutputFields: ['marker', 'processedAt'], renameAllowed: true, sourceNoiseAllowed: false,
      scopeReason: 'source is business-significant; source perturbation is outside this contract',
      attribution: 'our independent synthetic lawful semantic counterexample', evidence: [],
    },
  };
}

const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = async name => JSON.parse(await readFile(join(root, 'sources', name), 'utf8'));

export async function buildCorpus() {
  const fixtures = generateFixtures(), contracts = contractsFor(fixtures);
  const score = await source('identity-projection.workflow.json');
  const outside = await source('identity-projection.wrong-id.json');
  const silentGood = await source('silent-filter.fixed.json');
  const silentBad = await source('silent-filter.broken.json');
  const hOriginal = await source('relaybrook.original.json'), hRepaired = await source('relaybrook.repaired.json');
  const node = (workflow, name) => workflow.nodes.find(n => n.name === name);
  assert.ok(node(silentBad, 'Confidence Gate').parameters.jsCode.includes('item.json.source === "legacy-index"'));
  const inside = structuredClone(outside);
  const oldLiteral = 'id: "wrong-row"';
  assert.equal(node(inside, 'Select rows').parameters.jsCode.split(oldLiteral).length, 2);
  node(inside, 'Select rows').parameters.jsCode = node(inside, 'Select rows').parameters.jsCode.replace(oldLiteral, `id: ${JSON.stringify(fixtures.score.base[1].id)}`);
  const empty = structuredClone(score); node(empty, 'Select rows').parameters.jsCode = 'return [];';
  const whitelist = structuredClone(score);
  node(whitelist, 'Select rows').parameters.jsCode = node(whitelist, 'Select rows').parameters.jsCode.replace(
    'item.json.score >= 0.7', `item.json.score >= 0.7 && ${JSON.stringify(contracts.whitelist.literalWhitelist)}.includes(item.json.id)`);
  const currentOnly = structuredClone(silentGood);
  node(currentOnly, 'Confidence Gate').parameters.jsCode = 'return $input.all().filter(item => item.json.score >= 0.7 && item.json.source === "current-index");';
  const definitions = [
    ['D-score-correct', score, 'score', 'score', 'rename', [true, true], [true, true], 'consistent'],
    ['D-score-outside-literal', outside, 'score', 'score', 'rename', [false, false], [false, false], 'consistent'],
    ['D-score-inside-literal', inside, 'score', 'score', 'rename', [false, false], [true, false], 'inconsistent'],
    ['D-score-always-empty', empty, 'score', 'score', 'rename', [false, false], [true, true], 'consistent'],
    ['D-silent-correct', silentGood, 'silent', 'silent', 'source-noise', [true, true], [true, true], 'consistent'],
    ['D-silent-obsolete-source', silentBad, 'silent', 'silent', 'source-noise', [false, true], [true, true], 'inconsistent'],
    ['H-relaybrook-original', hOriginal, 'holdout', 'holdout', 'rename', [true, true], [true, true], 'consistent'],
    ['H-relaybrook-repaired', hRepaired, 'holdout', 'holdout', 'rename', [true, true], [true, true], 'consistent'],
    ['L-literal-whitelist', whitelist, 'whitelist', 'score', 'rename', [true, true], [true, true], 'scope_required'],
    ['L-current-only', currentOnly, 'currentOnly', 'silent', 'source-noise', [true, true], [true, true], 'scope_required'],
  ];
  const artifacts = ['canaries.mjs', 'check-canaries.mjs', 'run-native.mjs', 'PROTOCOL.md', 'package.json', 'LICENSE', 'source-provenance.json'];
  const provenance = JSON.parse(await readFile(join(root, 'source-provenance.json'), 'utf8'));
  artifacts.push(...provenance.sources.map(entry => entry.file));
  const save = async (file, value) => { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), json(value)); artifacts.push(file); };
  await save('contracts.json', contracts);
  for (const [family, pair] of Object.entries(fixtures)) {
    await save(`fixtures/${family}-base.json`, pair.base);
    await save(`fixtures/${family}-changed.json`, pair.changed);
    await save(`fixtures/${family}-map.json`, pair.identityMap);
  }
  const groups = [], runs = [];
  for (const [id, workflow, contractKey, fixtureKey, transformation, anchors, memberships, relation] of definitions) {
    const contract = contracts[contractKey], pair = fixtures[fixtureKey];
    const output = contract.family === 'leads' ? 'Merge duplicate leads' : fixtureKey === 'silent' ? 'Confidence Gate' : 'Select rows';
    const groupRuns = [];
    for (const [side, items] of [['base', pair.base], ['changed', pair.changed]]) {
      const label = `${id}-${side}`, frozenWorkflow = structuredClone(workflow);
      const expected = contract.family === 'leads' ? expectedLeads(items) : expectedIDs(items, contract);
      const assertions = contract.fields.map((field, i) => ({ node: output, ...(i === 0 ? { count: expected.length } : {}), pluck: `json.${field}`, equals: expected.map(row => row[field]) }));
      let input;
      if (contract.family === 'leads') {
        // Keep all 17 original functional nodes and their connections. Only the
        // sample data changes; native execution follows the original sample branch.
        node(frozenWorkflow, 'Sample messy leads').parameters.jsCode = `return ${JSON.stringify(items)}.map(json => ({ json }));`;
        input = { node: 'Run cleaner', items: [{}] };
        assertions.push(
          { node: 'Summarize cleaning run', count: 1, pluck: 'json.input_rows', equals: [items.length] },
          { node: 'Summarize cleaning run', pluck: 'json.output_rows', equals: [expected.length] },
          { node: 'Summarize cleaning run', pluck: 'json.duplicates_merged', equals: [items.length - expected.length] },
          ...['Read CSV file', 'Parse CSV rows', 'Read leads from Google Sheets', 'Convert to CSV', 'Write cleaned CSV file', 'Upsert into cleaned tab'].map(node => ({ node, count: 0 })),
        );
      } else input = { node: fixtureKey === 'silent' ? 'Retrieved rows' : 'Rows', items };
      const spec = { version: 1, name: label, input, ...(contract.family === 'leads' ? {} : { stopAfter: output }), mocks: [], timeoutMs: 60000, assertions };
      const run = { label, group: id, side, contractKey, output, businessInputFile: `fixtures/${fixtureKey}-${side}.json`,
        workflowFile: `matrix/${label}/workflow.json`, caseFile: `matrix/${label}/case.json`, expectedProjection: expected };
      await save(run.workflowFile, frozenWorkflow); await save(run.caseFile, spec);
      runs.push(run); groupRuns.push(label);
    }
    groups.push({ id, contractKey, fixtureKey, transformation, identityMap: pair.identityMap, runs: groupRuns,
      anticipated: { anchorPassed: anchors, membershipPassed: memberships, relationStatus: relation },
      sourceNodeCount: workflow.nodes.length, functionalSourceNodeCount: workflow.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length });
  }
  assert.equal(runs.length, 20);
  const plan = { schemaVersion: 1, corpus: 'r664-semantic-canaries', seeds, plannedExecutions: runs.length,
    supportCommands: ['one n8n --version', 'one n8n import:workflow'], executionMode: 'serial; no additional matrix',
    relationScope: 'rename only identity field via frozen bijection, or perturb declared diagnostic source label; compare declared ordered projections',
    domainScope: 'membership in all input identity values; occurrence overdraw is separate diagnostic, exact multiplicity and order belong to the independent anchor',
    expectedSource: 'only new business input plus frozen independent contract functions', groups, runs };
  await save('plan.json', plan);
  const ruleEvidence = [
    { file: 'sources/silent-filter.README.md', quote: 'The intended gate accepts scores ≥ 0.7.', role: 'independent intended score threshold' },
    { file: 'sources/identity-projection.README.md', quote: 'The contract checks two ordered IDs; timestamps can change between runs.', role: 'identity/order projection and dynamic timestamp exclusion' },
    { file: 'sources/relaybrook.README.md', quote: 'The first row wins and empty fields are filled from its duplicates.', role: 'first-row business rule' },
    { file: 'sources/relaybrook.README.md', quote: 'same mailbox (case, `+tags` and Gmail dots ignored)', role: 'mailbox equivalence rule; this fixture fixes a non-Gmail business domain' },
  ];
  for (const evidence of ruleEvidence) assert.ok((await readFile(join(root, evidence.file), 'utf8')).includes(evidence.quote), `Missing rule evidence: ${evidence.file}`);
  const files = [];
  for (const file of [...new Set(artifacts)].sort()) files.push({ file, sha256: digest(await readFile(join(root, file))) });
  const manifest = { schemaVersion: 1, corpus: plan.corpus, seeds, plannedExecutions: 20,
    phase: 'prepared-before-native; root freeze and independent review pending',
    sourceProvenance: provenance.sources, ruleEvidence, files,
    businessExpectedFromWorkflow: false, businessExpectedFromOldCases: false, businessExpectedFromPins: false, businessExpectedFromObservedOutputs: false,
    networkRequests: 0, nativeExecutions: 0, productChanges: 0,
    holdout: 'new valid alias family; prior Anna and padding fixtures excluded; original and repaired source equivalence is not a new bug discovery' };
  await writeFile(join(root, 'source-manifest.json'), json(manifest));
  return { plan, contracts, fixtures, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { plan } = await buildCorpus();
  console.log(JSON.stringify({ prepared: true, plannedExecutions: plan.plannedExecutions, groups: plan.groups.length, seeds, nativeExecutions: 0 }));
}
