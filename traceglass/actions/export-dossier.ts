import { defineAction } from '@agent-native/core/action';
import { z } from 'zod';
import { auditSample, atPointer, loadEvidence } from '../server/traceglass.ts';

export default defineAction({
  description: 'Create a downloadable release dossier with audit status, selected item, all caller roots, exact JSON pointers, and their raw values. Saved source files stay unchanged.',
  schema: z.object({ variant: z.enum(['original', 'repaired', 'missing']), item: z.number().int().min(0).max(1).default(0) }),
  http: { method: 'GET' }, readOnly: true,
  run: async ({ variant, item }) => {
    const sample = auditSample(variant), evidence = loadEvidence(variant);
    const selected = sample.raw_refs.find((row: any) => row.item === item);
    const raw = selected ? {
      parent: { pointer: selected.parent_pair, value: atPointer(evidence.parent, selected.parent_pair) },
      child: { pointer: selected.child_pair, value: atPointer(evidence.child, selected.child_pair) },
    } : null;
    return { filename: `traceglass-${variant}-item-${item}.json`,
      content: JSON.stringify({ product: 'Traceglass', example: 'Synthetic recorded n8n executions',
        selection: { variant, output: 0, item }, ...sample, selected_raw: raw,
        business_acceptance: 'Verify the actual destination and HTTP acceptance separately from source ancestry.' }, null, 2) };
  },
});
