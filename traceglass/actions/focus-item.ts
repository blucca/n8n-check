import { defineAction } from '@agent-native/core/action';
import { writeAppState } from '@agent-native/core/application-state';
import { z } from 'zod';

export default defineAction({
  description: 'Focus the shared workbench on an original, repaired, or missing-export case and terminal item. The human sees this exact selection; exports stay read-only.',
  schema: z.object({ variant: z.enum(['original', 'repaired', 'missing']), item: z.number().int().min(0).max(1) }),
  http: { method: 'POST' },
  run: async ({ variant, item }) => {
    const selection = { variant, output: 0, item };
    await writeAppState('selection', selection);
    return { selection, message: `Focused ${variant}, terminal item ${item}.` };
  },
});
