import { defineAction, type ActionRunContext } from '@agent-native/core/action';
import { z } from 'zod';
import viewScreen from './view-screen.ts';
import auditCall from './audit-call.ts';
import inspectRaw from './inspect-raw.ts';
import focusItem from './focus-item.ts';
import exportDossier from './export-dossier.ts';

const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const actions: Record<string, any> = { 'view-screen': viewScreen, 'audit-call': auditCall,
  'inspect-raw': inspectRaw, 'focus-item': focusItem, 'export-dossier': exportDossier };
// A bounded OpenAI-compatible agent adapter. It invokes the native definitions'
// validated run path, the same path as UI/CLI/HTTP. Only this pinned free model
// and these five application actions are exposed; six model turns is the cap.
export async function investigate(prompt: string, ctx?: ActionRunContext) {
  const key = process.env.OPENROUTER_API_KEY; // guard:allow-env-credential — operator-owned shared free-model key for this synthetic workspace
  if (!key) throw new Error('Set OPENROUTER_API_KEY on the self-hosted server, or use these same actions through the native CLI/HTTP.');
  const initialScreen = await viewScreen.run({}, ctx);
  const steps: any[] = [{ tool: 'view-screen', input: {}, result: initialScreen }];
  const tools = Object.entries(actions).map(([name, action]) => ({ type: 'function', function: {
    name, description: action.tool.description, parameters: action.tool.parameters } }));
  const messages: any[] = [{ role: 'system', content: `You are Traceglass, an n8n release investigator. Your work is visible in the shared human workbench. Current screen: ${JSON.stringify(initialScreen)}. Use the tools for facts. Diagnose the selected case, inspect the exact raw pairedItem values, and explain the derived caller roots versus observed pairing. Use focus-item when changing case or terminal selection; the UI follows. Original has successful executions and equal business JSON; business destination acceptance is a separate check. Repair comparison and dossier creation use tools. Missing runData needs a complete child export. Use plain text and two or three concise sentences. A child raw pairedItem names a preceding child-node item; the audit traverses those local links to compute the caller-root set. The audit expected array contains resolved caller roots, and observed contains the parent recorded caller roots. Preserve this distinction when describing raw values. Identify caller roots with their input item indexes and caller_items labels. Terminal customer names require inspect-raw evidence; keep caller labels attached to caller roots. For a compare-and-focus request, call focus-item for the repaired case and the same terminal item before inspecting additional repaired raw; then audit the repaired case and conclude. The current screen already includes original roots. Sample customers are synthetic. You have six turns; inspect first, conclude when evidence is sufficient.` }, { role: 'user', content: prompt }];
  let dossier: any;
  for (let turn = 0; turn < 6; turn++) {
    if (turn === 5) messages.push({ role: 'user', content: 'The tool budget is exhausted. Give a short plain-English conclusion from the recorded tool evidence. This turn has no tools.' });
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Traceglass' },
      body: JSON.stringify({ model, messages, ...(turn === 5 ? {} : { tools, tool_choice: 'auto' }),
        max_tokens: 2200, temperature: 0.1, reasoning: { enabled: false }, provider: { allow_fallbacks: true } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`Free agent provider returned HTTP ${response.status}. Retry later or connect an external agent to the native CLI/HTTP.`);
    const body: any = await response.json();
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('The free agent provider returned an empty turn. Retry this investigation.');
    messages.push(message);
    if (!message.tool_calls?.length) return { answer: message.content?.includes('<tool_call>') ? 'The agent reached its tool budget. Review the native action evidence below, then ask a narrower question.' : message.content || 'Review the tool evidence below.', steps, model, selection: (await viewScreen.run({}, ctx)).selection, dossier };
    for (const call of message.tool_calls) {
      let input: any, result: any;
      try {
        input = JSON.parse(call.function.arguments);
        const action = actions[call.function.name];
        if (!action) throw new Error('Use a listed Traceglass application action.');
        result = await action.run(input, { ...ctx, caller: 'tool', toolCallId: call.id });
        if (call.function.name === 'export-dossier') dossier = result;
      } catch (error) { result = { error: (error as Error).message }; }
      steps.push({ tool: call.function.name, input, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { answer: 'Investigation reached its six-turn limit. Review the evidence and continue with a narrower question.', steps, model, selection: (await viewScreen.run({}, ctx)).selection, dossier };
}
export default defineAction({
  description: 'Investigate the shared selected n8n item with a real free-model agent, native audit/raw/focus/dossier tools, and visible tool evidence. Six turns per request.',
  schema: z.object({ prompt: z.string().trim().min(1).max(3000) }),
  http: { method: 'POST' }, agentTool: false, mcpTool: false,
  run: async ({ prompt }, ctx) => investigate(prompt, ctx),
});
