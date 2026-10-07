import { writeFileSync } from 'node:fs';

// Source for the importable, standard-node workflow. Run from any directory.
const orders = 'blucca_vapi_demo_orders';
const callbacks = 'blucca_vapi_demo_callbacks';
const orderFields = ['orderId', 'email', 'status', 'carrier', 'trackingNumber', 'estimatedDelivery'];
const callbackFields = ['requestKey', 'orderId', 'email', 'phone', 'reason', 'status'];
const nodes = [];
const connections = {};
const node = (name, type, typeVersion, position, parameters = {}, extra = {}) => {
  nodes.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name,
    type: `n8n-nodes-base.${type}`, typeVersion, position, parameters, ...extra });
};
const code = (name, position, jsCode) => node(name, 'code', 2, position, { mode: 'runOnceForAllItems', jsCode });
const link = (from, to, output = 0) => {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
};
const bool = (name, position, expression) => node(name, 'if', 2.2, position, {
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: 'condition', leftValue: expression, rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {},
});
const tableRef = name => ({ __rl: true, mode: 'name', value: name });
const filters = pairs => ({ conditions: pairs.map(([keyName, keyValue]) => ({ keyName, condition: 'eq', keyValue })) });
const mapping = (fields, values = {}) => ({ mappingMode: 'defineBelow',
  value: Object.fromEntries(fields.map(key => [key, values[key] ?? `={{ $json.${key} }}`])),
  matchingColumns: [], schema: fields.map(id => ({ id, displayName: id, required: false,
    defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })), attemptToConvertTypes: false,
});
const createTable = (name, tableName, fields, position) => node(name, 'dataTable', 1.1, position, {
  resource: 'table', operation: 'create', tableName,
  columns: { column: fields.map(name => ({ name, type: 'string' })) }, options: { createIfNotExists: true },
});
const unavailable = 'Order support is temporarily unavailable. Please try again later.';

node('Set up demo tables', 'manualTrigger', 1, [-960, -620]);
createTable('Create demo orders', orders, orderFields, [-740, -620]);
createTable('Create callback queue', callbacks, callbackFields, [-520, -620]);
code('Two synthetic orders', [-300, -620], `return [
  {orderId:'ORD-1001',email:'alex@example.com',status:'shipped',carrier:'Demo Parcel',trackingNumber:'DEMO-1001',estimatedDelivery:'2026-10-12'},
  {orderId:'ORD-1002',email:'jamie@example.com',status:'processing',carrier:'',trackingNumber:'',estimatedDelivery:''}
].map(json => ({json}));`);
node('Seed demo orders', 'dataTable', 1.1, [-80, -620], { resource: 'row', operation: 'upsert',
  dataTableId: tableRef(orders), matchType: 'allConditions', filters: filters([['orderId', '={{ $json.orderId }}']]),
  columns: mapping(orderFields), options: {},
});
code('Setup ready', [140, -620], `return [{json:{ready:true,ordersTable:'${orders}',callbacksTable:'${callbacks}',seededOrders:$input.all().length,next:'Configure the Vapi webhook Header Auth credential, activate this workflow, and connect the two Vapi tools.'}}];`);
link('Set up demo tables', 'Create demo orders'); link('Create demo orders', 'Create callback queue');
link('Create callback queue', 'Two synthetic orders'); link('Two synthetic orders', 'Seed demo orders'); link('Seed demo orders', 'Setup ready');

node('Vapi webhook', 'webhook', 2.1, [-960, 0], { httpMethod: 'POST', path: 'vapi-order-support',
  authentication: 'headerAuth', responseMode: 'responseNode', options: {},
}, { webhookId: 'blucca-vapi-order-support', notes: 'Create Header Auth: Name X-Vapi-Secret; Value your shared secret. Configure the same header in both Vapi tools.' });
code('Split tool calls', [-740, 0], `const message = $input.first().json.body?.message;
if (message?.type !== 'tool-calls' || !Array.isArray(message.toolCallList) || message.toolCallList.length === 0) throw new Error('Expected a non-empty Vapi tool-calls message.');
const ids = new Set();
return message.toolCallList.map(call => {
  if (typeof call.id !== 'string' || !call.id || ids.has(call.id)) throw new Error('Tool call IDs must be present and unique.');
  ids.add(call.id);
  return {json:{toolCallId:call.id,callId:message.call?.id ?? '',toolName:call.function?.name ?? '',arguments:call.function?.arguments},pairedItem:{item:0}};
});`);
node('Each tool call', 'splitInBatches', 3, [-520, 0], { batchSize: 1, options: {} });
code('Validate current tool', [-300, 120], `const tool = $input.first().json;
const args = tool.arguments;
let error;
if (!['getOrderStatus','requestCallback'].includes(tool.toolName)) error = 'Unsupported tool. Use getOrderStatus or requestCallback.';
else if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.orderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(args.orderId.trim()) || typeof args.email !== 'string' || args.email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(args.email.trim())) error = 'Provide a valid orderId and email.';
else if (tool.toolName === 'requestCallback' && (typeof args.phone !== 'string' || !/^\\+?[0-9][0-9 ()-]{5,24}$/.test(args.phone.trim()) || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.trim().length > 500)) error = 'Provide a valid phone number and a reason of 1–500 characters.';
else if (tool.toolName === 'requestCallback' && (typeof tool.callId !== 'string' || !tool.callId)) error = 'Callback requests require a Vapi call ID.';
return [{json:{...tool,valid:!error,validationError:error,orderId:typeof args?.orderId === 'string' ? args.orderId.trim() : '',email:typeof args?.email === 'string' ? args.email.trim().toLowerCase() : '',phone:typeof args?.phone === 'string' ? args.phone.trim() : '',reason:typeof args?.reason === 'string' ? args.reason.trim() : '',requestKey:JSON.stringify([tool.callId,tool.toolCallId])}}];`);
bool('Valid arguments?', [-80, 120], '={{ $json.valid }}');
code('Argument error result', [140, 380], `const tool = $input.first().json; return [{json:{toolCallId:tool.toolCallId,error:tool.validationError}}];`);
node('Find matching order', 'dataTable', 1.1, [140, 40], { resource: 'row', operation: 'get',
  dataTableId: tableRef(orders), matchType: 'allConditions',
  filters: filters([['orderId', '={{ $json.orderId }}'], ['email', '={{ $json.email }}']]), returnAll: false, limit: 2,
}, { alwaysOutputData: true, onError: 'continueRegularOutput' });
code('Resolve order', [360, 40], `const tool = $('Validate current tool').item.json;
const items = $input.all(); const row = items[0].json;
let response; let callbackReady = false;
if (row.error || items[0].error || items.length > 1) response = {toolCallId:tool.toolCallId,error:${JSON.stringify(unavailable)}};
else if (!row.id || row.orderId !== tool.orderId || row.email !== tool.email) response = {toolCallId:tool.toolCallId,result:JSON.stringify({status:'order_not_found',message:'No order matched those details. Please check the order number and email.'})};
else if (tool.toolName === 'requestCallback') callbackReady = true;
else response = {toolCallId:tool.toolCallId,result:JSON.stringify({status:'found',orderId:row.orderId,fulfillmentStatus:row.status,carrier:row.carrier ?? '',trackingNumber:row.trackingNumber ?? '',estimatedDelivery:row.estimatedDelivery ?? ''})};
return [{json:{...tool,callbackReady,response}}];`);
bool('Callback ready?', [580, 40], '={{ $json.callbackReady }}');
code('Order result', [800, 280], `return [{json:$input.first().json.response}];`);
node('Find callback request', 'dataTable', 1.1, [800, -40], { resource: 'row', operation: 'get',
  dataTableId: tableRef(callbacks), matchType: 'allConditions', filters: filters([['requestKey', '={{ $json.requestKey }}']]), returnAll: false, limit: 2,
}, { alwaysOutputData: true, onError: 'continueRegularOutput' });
code('Resolve callback request', [1020, -40], `const tool = $('Resolve order').item.json;
const items = $input.all(); const row = items[0].json;
let response; let shouldStore = false;
if (row.error || items[0].error || items.length > 1) response = {toolCallId:tool.toolCallId,error:${JSON.stringify(unavailable)}};
else if (row.id) {
  if (['orderId','email','phone','reason'].some(key => row[key] !== tool[key])) response = {toolCallId:tool.toolCallId,error:'This tool call already recorded a different callback request.'};
  else response = {toolCallId:tool.toolCallId,result:JSON.stringify({status:'callback_requested',requestId:String(row.id),orderId:row.orderId,message:'Your callback request has been recorded for the support team.'})};
} else shouldStore = true;
return [{json:{...tool,shouldStore,response}}];`);
bool('Store new callback?', [1240, -40], '={{ $json.shouldStore }}');
node('Store callback request', 'dataTable', 1.1, [1460, -120], { resource: 'row', operation: 'upsert',
  dataTableId: tableRef(callbacks), matchType: 'allConditions', filters: filters([['requestKey', '={{ $json.requestKey }}']]),
  columns: mapping(callbackFields, { status: 'pending' }), options: {},
}, { alwaysOutputData: true, onError: 'continueRegularOutput' });
code('Stored callback result', [1680, -120], `const tool = $('Resolve callback request').item.json;
const items = $input.all(); const row = items[0].json;
if (row.error || items[0].error || items.length !== 1 || !row.id) return [{json:{toolCallId:tool.toolCallId,error:${JSON.stringify(unavailable)}}}];
return [{json:{toolCallId:tool.toolCallId,result:JSON.stringify({status:'callback_requested',requestId:String(row.id),orderId:row.orderId,message:'Your callback request has been recorded for the support team.'})}}];`);
code('Existing callback result', [1460, 120], `return [{json:$input.first().json.response}];`);
code('Build Vapi response', [-300, -240], `return [{json:{results:$input.all().map(item => item.json)}}];`);
node('Respond to Vapi', 'respondToWebhook', 1.4, [-80, -240], { respondWith: 'json', responseBody: '={{ $json }}', options: { responseCode: 200 } });
link('Vapi webhook', 'Split tool calls'); link('Split tool calls', 'Each tool call');
link('Each tool call', 'Build Vapi response', 0); link('Build Vapi response', 'Respond to Vapi');
link('Each tool call', 'Validate current tool', 1); link('Validate current tool', 'Valid arguments?');
link('Valid arguments?', 'Find matching order', 0); link('Valid arguments?', 'Argument error result', 1);
link('Argument error result', 'Each tool call'); link('Find matching order', 'Resolve order'); link('Resolve order', 'Callback ready?');
link('Callback ready?', 'Find callback request', 0); link('Callback ready?', 'Order result', 1); link('Order result', 'Each tool call');
link('Find callback request', 'Resolve callback request'); link('Resolve callback request', 'Store new callback?');
link('Store new callback?', 'Store callback request', 0); link('Store new callback?', 'Existing callback result', 1);
link('Store callback request', 'Stored callback result'); link('Stored callback result', 'Each tool call'); link('Existing callback result', 'Each tool call');

node('Start here — 5 minute setup', 'stickyNote', 1, [-1020, -1140], { width: 1530, height: 390, color: 5,
  content: `## Vapi order support: status answers + human callback queue\n**1. Run “Set up demo tables” once.** It creates ${orders} and ${callbacks}, then upserts two synthetic orders. Re-running setup restores those two demo orders; callback records stay in place. Tables are referenced by name in this workflow's project.\n**2. Configure “Vapi webhook” → Header Auth:** header name **X-Vapi-Secret**, a secret value of your choice. Set the same header in the server settings of both Vapi tools.\n**3. Activate the workflow.** Copy the Production webhook URL into both tools. Tool definitions and sample requests are alongside workflow.json.\n**4. Try ORD-1001 / alex@example.com and ORD-1002 / jamie@example.com.** All seed values are synthetic.\n**5. Open the callback Data Table.** Filter status=pending, contact the customer, and update status when handled. Callback responses acknowledge a recorded request.\nUses standard n8n nodes and Data Tables v1.1; target n8n 2.41.7.`,
});
node('Tool contract and outcomes', 'stickyNote', 1, [-1020, 580], { width: 1390, height: 380, color: 4,
  content: `## One result per tool call\n**getOrderStatus(orderId, email):** exact order ID and normalized email must match the same row. Returns only status, carrier, tracking number and estimated delivery.\n**requestCallback(orderId, email, phone, reason):** verifies that order, stores a request, returns the row ID. Requires message.call.id.\nMissing order / mismatched email share the order_not_found business result. Unknown tools and invalid arguments return that tool's error; sibling tools continue. HTTP 200 wraps all results. Each result/error is a single-line string paired with its original toolCallId.\nInput is the Vapi custom-tools shape: body.message.type=tool-calls and message.toolCallList[].function.arguments as an object. Tool-call IDs must be non-empty and unique within a message. Configure the assistant to ask the caller to check their order ID/email after order_not_found.`,
});
node('Connect real orders and handle callbacks', 'stickyNote', 1, [440, -680], { width: 1440, height: 460, color: 6,
  content: `## From synthetic demo to your support queue\nPopulate the orders table with your own orderId, email, status, carrier, trackingNumber and estimatedDelivery columns. Normalize email to lowercase. Use one row per orderId/email pair. Keep table names unique in this n8n project; select your tables in the Data Table nodes when adapting names. Run the seed branch against dedicated demo tables.\n## Replay behavior\nCallback requestKey = JSON.stringify([message.call.id, toolCall.id]). A sequential replay returns the existing row and preserves its status. Changed callback details for that key produce an explicit error. A new toolCallId creates a new request.\nData Table upsert uses a transaction with update/insert. Concurrent first writes require a separately verified deployment contract; PostgreSQL UNIQUE(requestKey) is the integration path for atomic business uniqueness.\n## Operational scope\nThe supplied workflow stores an actionable callback queue for a support operator. Customer communications, store synchronization and voice-agent behavior follow your connected systems. Keep the order response fields concise and set Vapi tool timeout to suit your tested n8n endpoint latency.`,
});

const workflow = { name: 'Answer order-status calls and capture callbacks with Vapi and Data Tables', nodes, connections,
  settings: { executionOrder: 'v1' }, active: false };
writeFileSync(new URL('./workflow.json', import.meta.url), `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote workflow.json: ${nodes.length} nodes (${nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length} executable).`);
