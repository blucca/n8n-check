import { defineAgentNativeConfig } from '@agent-native/core/config';
export default defineAgentNativeConfig({
  changelog: { enabled: false },
  onboarding: { firstRun: 'off' },
  harness: false,
});
