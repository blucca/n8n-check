// Produce the immutable task/data bundle before any prospective model call.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
if (process.argv.length !== 4) throw Error('Usage: node freeze-pilot.mjs PREPARED_MORSOF_DIR OUTPUT.json');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const invoiceWorkflow = await read(join(resolve(process.argv[2]), 'fixed.workflow.json'));
const retryWorkflow = await read(join(root, 'examples/retry-isolation/loop.json'));
const rawWorkflow = await read(join(root, 'examples/raw-response/raw-file.json'));
retryWorkflow.nodes.find(n => n.name === 'Render').parameters.jsonBody = '={{ { tenant: $json.tenant, shortId: $json.shortId, revision: $json.revision, renderOptions: $json.styling } }}';
const node = (w, name) => w.nodes.find(n => n.name === name);
const copy = x => structuredClone(x);

const invoice = (id, amount = 100, dueDate = '2030-06-22') => ({
  invoiceId: id, customer: { id: 'C-' + id, name: 'Fictional ' + id, email: id.toLowerCase() + '@fixture.example', phone: '' },
  currency: 'EUR', totalAmount: amount, paidAmount: 0, outstandingAmount: amount, dueDate,
  paymentStatus: 'unpaid', disputed: false, updatedAt: '2030-06-19T10:00:00.000Z',
});
const stage = v => v.dueDate === '2030-06-20' ? 'due_today' : 'upcoming_3_days';
const output = (v, outcome) => ({ invoiceId: v.invoiceId, customerId: v.customer.id, email: v.customer.email,
  outstandingAmount: v.outstandingAmount, outcome, draftNull: ['review', 'no_action_required'].includes(outcome) });
const row = v => ({ invoiceId: v.invoiceId, customerId: v.customer.id, outstandingAmount: v.outstandingAmount, stage: stage(v) });
const invoiceCase = (name, invoices, outcomes, writes) => ({ name, invoices,
  expectedOutputs: invoices.map((v, i) => output(v, outcomes[i])), expectedRows: writes.map(row) });
const A = invoice('INV-VISIBLE-A'), B = invoice('INV-VISIBLE-B', 85, '2030-06-20');
const visibleInvoice = invoiceCase('reported-two-invoice-input', [A, B], ['ready_for_review', 'ready_for_review'], [A, B]);
const changedA = copy(A); changedA.customer = { ...changedA.customer, id: 'C-OTHER-VISIBLE', email: 'other@fixture.example' };
const C = invoice('INV-VISIBLE-C', 130), changedC = { ...copy(C), totalAmount: 171, outstandingAmount: 171 };
const expandedInvoice = invoiceCase('same-batch-contract-probe', [A, C, B, changedA, changedC],
  ['review', 'review', 'ready_for_review', 'review', 'review'], [B]);
const H = invoice('INV-HELD-617', 237), J = invoice('INV-HELD-892', 62, '2030-06-20');
const changedH = copy(H); changedH.customer = { ...changedH.customer, id: 'C-HELD-OTHER', email: 'held-other@fixture.example' };
const amountH = { ...copy(H), totalAmount: 286, outstandingAmount: 286 };
const paid = invoice('INV-HELD-PAID', 91); Object.assign(paid, { paidAmount: 91, outstandingAmount: 0, paymentStatus: 'paid' });
const invoiceHidden = [
  invoiceCase('held-identical-duplicate', [J, H, copy(H)], ['ready_for_review', 'ready_for_review', 'already_prepared'], [J, H]),
  invoiceCase('held-nonadjacent-customer-conflict', [H, J, changedH], ['review', 'ready_for_review', 'review'], [J]),
  invoiceCase('held-third-member-amount-conflict-and-paid', [H, paid, copy(H), J, amountH],
    ['review', 'no_action_required', 'review', 'ready_for_review', 'review'], [J]),
];
const invoiceReference = `const items = $input.all();
const signatures = new Map();
for (const {json: v} of items) {
  if (v.outputPath !== 'ready_for_review') continue;
  const key = JSON.stringify([v.invoiceId, v.reminderStage]);
  const signature = JSON.stringify([v.customerId, v.email, v.currency, v.totalAmount, v.paidAmount, v.outstandingAmount, v.dueDate]);
  if (!signatures.has(key)) signatures.set(key, new Set());
  signatures.get(key).add(signature);
}
return items.map((item, index) => {
  const v = item.json;
  if (v.outputPath !== 'ready_for_review') return item;
  const key = JSON.stringify([v.invoiceId, v.reminderStage]);
  if (signatures.get(key).size > 1) return {json: {...v, classification: 'requiring_manual_review', reminderStage: '', outputPath: 'manual_review', actionReason: 'conflicting_invoice_payload', draft: null}, pairedItem: {item: index}};
  return {json: {...v, historyKey: v.invoiceId.trim() + '::' + v.reminderStage.trim()}, pairedItem: {item: index}};
});`;

const operation = (tenant, shortId, revision, fontSize) => ({ tenant, shortId, revision, styling: { fontSize } });
const payload = v => ({ tenant: v.tenant, shortId: v.shortId, revision: v.revision, renderOptions: v.styling });
const initial = [operation('studio-visible', '42', 'v1', 31), operation('studio-visible', '43', 'v1', 47)];
const effects = initial.map(payload);
const visibleRetry = { name: 'reported-two-operation-input', input: initial, expectedEffects: effects };
const newer = operation('studio-visible', '42', 'v2', 63), other = operation('studio-other', '42', 'v1', 31);
const h1 = operation('cedar-project', '617', 'rev-07', 27), h2 = operation('cedar-project', '892', 'rev-07', 54);
const hRevision = operation('cedar-project', '617', 'rev-08', 71), hTenant = operation('maple-project', '617', 'rev-07', 27);
const retryHidden = [
  { name: 'held-initial-commit-503', input: [h1, h2], expectedEffects: [h1, h2].map(payload) },
  { name: 'held-reordered-replay', input: [h2, h1], expectedEffects: [h1, h2].map(payload) },
  { name: 'held-new-revision', input: [hRevision], expectedEffects: [h1, h2, hRevision].map(payload) },
  { name: 'held-new-tenant', input: [hTenant], expectedEffects: [h1, h2, hRevision, hTenant].map(payload) },
];

const rawVisible = { name: 'reported-json-object', value: { id: 'visible-receipt-42', status: 'accepted' }, bom: false };
const rawExpanded = { name: 'root-array-and-utf8-bom', value: [{ id: 'visible-array-11', message: '已送达' }, { id: 'visible-array-12', message: 'Livré' }], bom: true };
const rawHidden = [
  { name: 'held-object', value: { id: 'held-receipt-617', detail: { accepted: true, labels: ['fresh', 'verified'] } }, bom: false },
  { name: 'held-root-array', value: [{ id: 'held-array-892', message: '受信' }, { id: 'held-array-617', nested: { cents: 23700 } }], bom: false },
  { name: 'held-bom-multibyte', value: { id: 'held-bom-071', message: '已送达 · café · 🛰️' }, bom: true },
];
const rawAlternative = { type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { mode: 'runOnceForAllItems', jsCode: `const out = []; for (let i = 0; i < $input.all().length; i++) { const bytes = await this.helpers.getBinaryDataBuffer(i, 'data'); out.push({json: {receipt: JSON.parse(bytes.toString('utf8').replace(/^\\uFEFF/, ''))}, pairedItem: {item: i}}); } return out;` } };

const common = 'You are maintaining an n8n 2.41.7 workflow. Review the designated node against the complete requirements below. Return the smallest complete replacement allowed by the output schema, or retain a correct implementation. Only the specified node field can change; the remaining graph is fixed. Return one JSON object and no prose. Use valid JSON escaping for code strings.';
const invoicePrompt = `${common}
TASK: Invoice reminder batch policy (a new, explicitly requested policy on a source-derived workflow).
The upstream node already normalizes each invoice into item.json with invoiceId, reminderStage, customerId, email, currency, totalAmount, paidAmount, outstandingAmount, dueDate, outputPath, classification, actionReason and draft. This Code node runs once for all items using $input.all().
Requirements: preserve one outcome and the exact customer/amount identity for every input. Among items whose outputPath is ready_for_review, members with the same invoiceId and reminderStage belong to one group. If any members disagree on customerId, email, currency, totalAmount, paidAmount, outstandingAmount or dueDate, EVERY member of that group must go to manual review and none may be stored as prepared. Identical duplicates remain eligible and downstream code stores one row and emits one ready_for_review outcome plus already_prepared outcomes for duplicates. Unrelated groups must still complete. Preserve non-ready items unchanged. Comparison is within this batch; cross-execution history reconciliation is handled elsewhere.
For a conflicting item set outputPath='manual_review', classification='requiring_manual_review', reminderStage='', draft=null and an explanatory actionReason, preserving its other identity fields. For each eligible nonconflicting item retain historyKey=trim(invoiceId)+'::'+trim(reminderStage) because the fixed downstream nodes use that key. Return n8n items {json:...,pairedItem:{item:originalIndex}} when constructing a new item.
The fixed downstream graph loads history, routes by outputPath, groups eligible items by historyKey, stores the first member of an identical group, then reattaches a per-input result. Do not edit or replace that graph.
Current designated jsCode:
${node(invoiceWorkflow, 'Group Batch Reminder Keys').parameters.jsCode}
Reported raw input (the upstream normalization described above runs before your node):
${JSON.stringify([A, B])}
Output schema: {"jsCode":"complete replacement JavaScript for Group Batch Reminder Keys"}.`;
const retryPrompt = `${common}
TASK: Retry-safe rendering with a durable external API.
A fixed Loop Over Items (batchSize=1) sends each input through the Render HTTP Request node, with retryOnFail=true, maxTries=2. The service commits a render before its first 503. It returns {id,request:<stored payload>} on success. The original no-key workflow creates three rows for two logical operations after that retry.
The API honors the Idempotency-Key header: the first request for a key stores its body; later requests for that key return that stored result. A logical operation is the exact tuple (tenant, shortId, revision), all three fields are ASCII strings. Repeated delivery, including a new workflow execution, must reuse its key and create no extra effect. A different tenant, asset shortId, or revision must retain its own effect and response payload. Keys must be deterministic across process restarts. The body already includes tenant, shortId, revision and renderOptions from styling; keep it unchanged. Do not alter the server, loop, retry settings, inputs or graph.
Current Render node:
${JSON.stringify(node(retryWorkflow, 'Render'))}
Reported input:
${JSON.stringify(initial)}
Your returned expression becomes the single Idempotency-Key header value, with sendHeaders=true. It must be a complete n8n expression, including the ={{ ... }} wrapper, evaluated separately using the current $json.
Output schema: {"expression":"={{ JavaScript expression }}"}.`;
const rawPrompt = `${common}
TASK: Preserve a raw JSON response as a receipt.
The fixed HTTP Request node sends POST with the exact raw body {"message":"hello"}, content type application/json. Its response format is File, output binary field 'data'. Each HTTP response is one complete UTF-8 JSON object or array and may start with a UTF-8 BOM. Preserve the entire parsed JSON value under item.json.receipt: one output item per input response, including when the root value is an array. Preserve nested values and non-ASCII text. Keep the POST body and HTTP node unchanged.
Current Read receipt node:
${JSON.stringify(node(rawWorkflow, 'Read receipt'))}
Reported response:
${JSON.stringify(rawVisible.value)}
The designated Read receipt node may remain unchanged by returning {"keep":true}. If you replace it, the only allowed types are n8n-nodes-base.extractFromFile or n8n-nodes-base.code; return {"type":"...","typeVersion":1.1,"parameters":{...}} with the appropriate version. Code nodes use version 2 and may use this.helpers.getBinaryDataBuffer(index,'data'); do not assume binary.data.data is an inline base64 string. You may retain the native extractor. Output one allowed JSON object.`;

const spec = {
  protocol: 'paired-pilot-v1', frozenAt: new Date().toISOString(), stage: 'prospective model pilot on development-derived task families',
  model: { repository: 'litert-community/gemma-4-E2B-it-litert-lm', revision: 'b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1', runtime: 'litert-lm-api==0.18.0', backend: 'CPU', maxContextTokens: 8192 },
  budget: { seeds: [17701, 17702], sharedInitialCallsPerPair: 1, revisionCallsPerArm: 1, revisionSeedOffset: 100000, maxOutputTokens: 1536, thinking: false, temperature: 0.7, topP: 0.95, topK: 40, feedbackExecutionsPerArm: 2, feedbackCharacterLimit: 6000 },
  exclusions: ['All 22 authored development-seed invocations', 'Access-probe answer and post-hoc hyphen-collision witness', 'Any delimiter-collision test; this pilot grades scope/version only'],
  tasks: [
    { id: 'invoice', role: 'repair', provenance: 'Morsoflab MIT source at 3d8c61ee5b0e37e7e0052f53e7839db011b9c0de plus researcher-added same-batch conflict policy', prompt: invoicePrompt, workflow: invoiceWorkflow, reference: { jsCode: invoiceReference }, feedback: { original: [visibleInvoice, { ...copy(visibleInvoice), name: 'reported-input-repeat' }], contract: [visibleInvoice, expandedInvoice] }, hidden: invoiceHidden },
    { id: 'retry', role: 'repair', provenance: 'Researcher-authored synthetic workflow/error scenario; response-loss bug is a prior known control', prompt: retryPrompt, workflow: retryWorkflow, reference: { expression: '={{ JSON.stringify([$json.tenant, $json.shortId, $json.revision]) }}' }, feedback: { original: [visibleRetry, { ...copy(visibleRetry), name: 'reported-input-replay' }], contract: [visibleRetry, { name: 'scope-version-and-replay-probe', input: [newer, other, initial[0]], expectedEffects: [...effects, payload(newer), payload(other)] }] }, hidden: retryHidden },
    { id: 'raw', role: 'correct-implementation-retention', provenance: 'Researcher-owned export derived from n8n issue 36402; initially correct native extractor', prompt: rawPrompt, workflow: rawWorkflow, reference: { keep: true }, alternativeReference: rawAlternative, feedback: { original: [rawVisible, { ...copy(rawVisible), name: 'reported-response-repeat' }], contract: [rawVisible, rawExpanded] }, hidden: rawHidden },
  ],
};
await writeFile(resolve(process.argv[3]), JSON.stringify(spec, null, 2) + '\n');
console.log(JSON.stringify({ protocol: spec.protocol, frozenAt: spec.frozenAt, tasks: spec.tasks.map(t => ({ id: t.id, hiddenCases: t.hidden.length })), generations: 18 }));
