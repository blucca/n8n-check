import { defineAction } from '@agent-native/core/action';
import { z } from 'zod';
import { auditSample } from '../server/traceglass.ts';

export default defineAction({
  description: 'Diagnose a saved n8n parent-child call. Compare the child-derived caller roots with the recorded parent pairing, and return exact raw evidence pointers. Execution exports stay read-only; business HTTP acceptance is a separate check.',
  schema: z.object({ variant: z.enum(['original', 'repaired', 'missing']).default('original') }),
  http: { method: 'GET' },
  readOnly: true,
  run: async ({ variant }) => auditSample(variant),
});
