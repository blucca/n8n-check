import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAgentNativeQueryClient, useDbSync } from '@agent-native/core/client/hooks';
import Workbench from './Workbench';

const queryClient = createAgentNativeQueryClient();
function App() {
  useDbSync({ queryClient });
  return <Workbench />;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}><App /></QueryClientProvider>,
);
