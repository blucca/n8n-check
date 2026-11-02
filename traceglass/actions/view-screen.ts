import { defineAction } from '@agent-native/core/action';
import { readAppState } from '@agent-native/core/application-state';
import { z } from 'zod';
import { auditSample, type Variant } from '../server/traceglass.ts';

export default defineAction({
  description: 'See the human’s current selected saved call and terminal item. Hydrate the same selection, navigation, URL, audit findings and exact raw pointers used by the workbench.',
  schema: z.object({}), http: { method: 'GET' }, readOnly: true,
  run: async () => {
    const selection: any = await readAppState('selection');
    const navigation = await readAppState('navigation');
    const url = await readAppState('__url__');
    const variant: Variant = selection?.variant ?? 'original';
    const sample = auditSample(variant);
    const item = selection?.item ?? 0;
    return { selection: { variant, output: 0, item }, navigation, url,
      status: sample.audit.status,
      finding: sample.audit.findings?.find((row: any) => row.item === item),
      raw_refs: sample.raw_refs.filter((row: any) => row.item === item),
      caller_items: sample.input_items,
      scope: sample.audit.scope ?? 'Full child runData is required for a source decision.' };
  },
});
