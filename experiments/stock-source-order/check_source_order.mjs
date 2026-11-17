// Consumer test for an exported setStock(eventId, lines) function. Local fixture only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const [modulePath, outputPath] = process.argv.slice(2);
assert(modulePath && outputPath, 'Usage: node check_source_order.mjs fixture-setStock.mts observed.json');
const item = 'gid://shopify/InventoryItem/123456';
const location = 'gid://shopify/Location/456789';
const versions = [
  { eventId: 'source-v1', sourceVersion: 1, quantity: 12 },
  { eventId: 'source-v2', sourceVersion: 2, quantity: 7 },
];
let available = null;
const received = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/admin/api/2025-07/graphql.json');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const input = body.variables.input;
    assert.equal(input.ignoreCompareQuantity, true);
    assert.equal(input.name, 'available');
    assert.equal(input.quantities.length, 1);
    const line = input.quantities[0];
    assert.equal(line.inventoryItemId, item);
    assert.equal(line.locationId, location);
    assert.equal(typeof line.quantity, 'number');
    available = line.quantity; // Model the unconditional absolute-write branch only.
    received.push({ body, referenceDocumentUri: input.referenceDocumentUri,
      ignoreCompareQuantity: input.ignoreCompareQuantity, line, available });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { inventorySetQuantities: {
      inventoryAdjustmentGroup: { id: `fixture-group-${received.length}` }, userErrors: [] } } }));
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ errors: [{ message: String(error) }] }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.STOCK_FIXTURE_ENDPOINT = `http://127.0.0.1:${server.address().port}/admin/api/2025-07/graphql.json`;
process.env.SHOPIFY_ADMIN_TOKEN = 'fixture-only-not-a-real-token';
const panels = [];
try {
  for (const [name, delivery] of [['in-source-order', [0, 1]], ['late-first-delivery', [1, 0]]]) {
    available = null;
    const start = received.length;
    // Separate module instances reset the sample's processed-event Set for each panel.
    const { setStock } = await import(pathToFileURL(resolve(modulePath)).href + `?panel=${name}`);
    const calls = [];
    for (const index of delivery) {
      const event = versions[index];
      calls.push({ ...event, result: await setStock(event.eventId,
        [{ inventoryItemId: item, locationId: location, quantity: event.quantity }]) });
    }
    const requestCountBeforeDuplicate = received.length;
    const duplicate = await setStock(versions[0].eventId,
      [{ inventoryItemId: item, locationId: location, quantity: versions[0].quantity }]);
    assert.deepEqual(calls.map(x => x.result), ['updated', 'updated']);
    assert.equal(duplicate, 'duplicate');
    assert.equal(received.length, requestCountBeforeDuplicate);
    assert.equal(available, name === 'in-source-order' ? 7 : 12);
    panels.push({ name, calls, expectedLatestSourceQuantity: 7,
      receiverFinalAvailable: available, latestSourceContractPassed: available === 7,
      successfulEventDuplicate: { result: duplicate, extraHttpRequests: 0 },
      physicalHttpRequests: received.slice(start) });
  }
  assert.equal(received.length, 4);
  assert.equal(panels[0].latestSourceContractPassed, true);
  assert.equal(panels[1].latestSourceContractPassed, false);
  const report = {
    source: 'https://werun.dev/blog/shopify-inventory-sync-fix',
    runtime: process.version,
    sourceAdaptation: 'Only ENDPOINT constant changed to STOCK_FIXTURE_ENDPOINT; function and fetch logic unchanged.',
    fixture: 'Actual loopback HTTP, unconditional absolute write, successful GraphQL response. No Shopify store or production queue.',
    expectedBasis: 'Independent latest source version: v2=7 at the same inventory item and location.',
    panels,
    experimentObservationsPassed: true,
    scope: 'setStock invoked in the listed source-version order. A queue enforcing source order can exclude the reversed panel.',
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await new Promise(resolve => server.close(resolve));
}
