import { createAgentChatPlugin, loadActionsFromStaticRegistry } from '@agent-native/core/server';
import registry from '../../.generated/actions-registry';

const native = loadActionsFromStaticRegistry(registry);
const names = ['audit-call', 'inspect-raw', 'view-screen', 'focus-item', 'export-dossier', 'investigate'];
export default createAgentChatPlugin({
  appId: 'traceglass',
  actions: Object.fromEntries(names.map(name => [name, native[name]])),
  initialToolNames: names.filter(name => name !== 'investigate'),
  frameworkTools: 'minimal',
  systemPrompt: 'You are Traceglass. Investigate saved n8n caller identity through audit-call and inspect-raw. Read view-screen for the human selection, focus-item to share your focus, and export-dossier for the exact release evidence. Saved exports stay read-only; verify actual business destination acceptance separately.',
});
