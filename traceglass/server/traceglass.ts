import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// One instance is a shared synthetic workspace. Self-host with the full n8n-check
// checkout; this adapter reads its sole auditor rather than copying that logic.
const evidenceRoot = resolve(process.cwd(), '../experiments/lineage-boundary');
const require = createRequire(import.meta.url);
const { auditBoundary } = require(resolve(evidenceRoot, 'audit-executions.cjs'));
export type Variant = 'original' | 'repaired' | 'missing';

export function loadEvidence(variant: Variant) {
  const base = variant === 'original' ? 'original' : 'repaired';
  const read = (role: string) => JSON.parse(readFileSync(
    resolve(evidenceRoot, 'recorded', `${base}-${role}.json`), 'utf8'));
  const parent = read('parent'), child = read('child');
  // A declared synthetic missing-export case; saved baseline files stay intact.
  if (variant === 'missing') delete child.data.resultData.runData;
  return { parent, child, files: [`${base}-parent.json`, `${base}-child.json`] };
}

const escapePointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
export function auditSample(variant: Variant) {
  const { parent, child, files } = loadEvidence(variant);
  let audit: any;
  try { audit = auditBoundary(parent, child); }
  catch (error) { audit = { status: 'incomplete', reason: (error as Error).message }; }
  const terminal = child.data.resultData.lastNodeExecuted;
  const terminalRun = (child.data.resultData.runData?.[terminal]?.length ?? 1) - 1;
  const caller = audit.caller_input;
  const input = caller ? parent.data.resultData.runData[caller.node][caller.run].data.main[caller.output] : [];
  return {
    variant, audit, files, terminal_node: terminal, terminal_run: terminalRun,
    executions: { parent: { id: parent.id, status: parent.status }, child: { id: child.id, status: child.status } },
    input_items: input.map((value: any, index: number) => ({ index, json: value.json })),
    raw_refs: (audit.findings ?? []).map((row: any) => ({
      output: row.output, item: row.item,
      parent_pair: `/data/resultData/runData/${escapePointer(audit.node)}/${audit.run}/data/main/${row.output}/${row.item}/pairedItem`,
      child_pair: `/data/resultData/runData/${escapePointer(terminal)}/${terminalRun}/data/main/${row.output}/${row.item}/pairedItem`,
    })),
  };
}

export function atPointer(value: any, pointer: string): any {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error('Use an RFC 6901 JSON pointer starting with /.');
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value == null || !Object.hasOwn(value, key)) throw new Error('This raw pointer is absent from the selected export.');
    value = value[key];
  }
  return value;
}
