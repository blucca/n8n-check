import { defineAgentNativeConfig } from '@agent-native/core/config';
export default defineAgentNativeConfig({
  // Public synthetic workspace: all visitors and agents share the same selection.
  runtime: { auth: { enabled: false } },
  changelog: { enabled: false },
  onboarding: { firstRun: 'off' },
  harness: false,
});
