import { defineAction } from '@agent-native/core/action';
import { z } from 'zod';
import { atPointer, loadEvidence } from '../server/traceglass.ts';

export default defineAction({
  description: 'Read an exact JSON pointer from a selected synthetic saved parent or child export. Use audit-call raw_refs to inspect recorded pairedItem evidence.',
  schema: z.object({
    variant: z.enum(['original', 'repaired', 'missing']).default('original'),
    role: z.enum(['parent', 'child']),
    pointer: z.string().max(768),
  }),
  http: { method: 'GET' },
  readOnly: true,
  run: async ({ variant, role, pointer }) => {
    const value = atPointer(loadEvidence(variant)[role], pointer);
    if (JSON.stringify(value).length > 5000) throw new Error('Select a narrower raw pointer; complete exports are linked in the dossier.');
    return { variant, role, pointer, value };
  },
});
