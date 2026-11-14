// Small real-browser check. Requires already-installed playwright and ws.
// NODE_PATH selects those dependencies; CHROME_PATH selects an existing Chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { WebSocketServer } = require('ws');

(async () => {
  const server = http.createServer((_, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script>window.socket = new WebSocket(`ws://${location.host}/rest/push?pushRef=synthetic-push`)</script>');
  });
  const wsServer = new WebSocketServer({ server });
  const connection = new Promise((resolve) => wsServer.once('connection', resolve));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const peer = await connection;
    await page.waitForFunction(() => window.socket.readyState === WebSocket.OPEN);

    // Negative control: a late constructor hook sees no already-open socket.
    await page.evaluate(() => {
      window.lateHookCount = 0;
      window.baselineFrame = new Promise((resolve) => socket.addEventListener('message', (event) => resolve(event.data), { once: true }));
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = function (...args) {
        const socket = new NativeWebSocket(...args);
        socket.addEventListener('message', () => window.lateHookCount++);
        return socket;
      };
      window.restoreConstructor = () => { window.WebSocket = NativeWebSocket; };
    });
    peer.send(JSON.stringify({ type: 'beforeProbe', data: {} }));
    assert.equal(JSON.parse(await page.evaluate(() => window.baselineFrame)).type, 'beforeProbe');
    await page.evaluate(() => window.restoreConstructor());

    const client = await page.context().newCDPSession(page);
    const source = fs.readFileSync(path.join(__dirname, 'live-socket-probe.js'), 'utf8');
    const loaded = await client.send('Runtime.evaluate', { expression: source });
    assert.equal(loaded.exceptionDetails, undefined);
    // The Console helper displays its array instead of returning it. Query via
    // CDP and store that exact object globally, as DevTools' context menu does.
    const prototype = await client.send('Runtime.evaluate', { expression: 'WebSocket.prototype' });
    const objects = await client.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId });
    const saved = await client.send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, functionDeclaration: 'function () { window.temp1 = this; }' });
    assert.equal(saved.exceptionDetails, undefined);
    assert.equal(await page.evaluate(() => observeN8nPushSockets(temp1).socketCount), 1);
    peer.send(JSON.stringify({ type: 'testWebhookReceived', data: { workflowId: 'sample-workflow', executionId: '44', privateBody: 'omit-this' } }));
    peer.send(Buffer.from(JSON.stringify({ type: 'executionStarted', data: { executionId: '44', privateBody: 'omit-this' } })), { binary: true });
    await page.waitForFunction(() => __n8nPushProbe.records.filter((entry) => entry.event === 'frame').length >= 2);
    await page.evaluate(() => { socket.binaryType = 'arraybuffer'; });
    peer.send(Buffer.from('not-json'), { binary: true });
    await page.waitForFunction(() => __n8nPushProbe.records.filter((entry) => entry.event === 'frame').length >= 3);
    const result = await page.evaluate(() => ({ records: __n8nPushProbe.records, lateHookCount }));
    const frames = result.records.filter((entry) => entry.event === 'frame');
    assert.deepEqual(frames.map((entry) => entry.type), ['testWebhookReceived', 'executionStarted', 'non-json']);
    assert.equal(frames[0].workflowId, 'sample-workflow');
    assert.equal(frames[0].executionId, '44');
    assert.equal(frames[1].executionId, '44');
    assert.equal(result.lateHookCount, 0);
    assert.ok(frames.every((entry) => entry.bytes > 0));
    assert.ok(!JSON.stringify(result.records).includes('omit-this'));

    // A later message after stopping must not reach the removed listeners.
    await page.evaluate(() => { __n8nPushProbe.stop(); window.afterStop = new Promise((resolve) => socket.addEventListener('message', resolve, { once: true })); });
    peer.send(JSON.stringify({ type: 'afterStop', data: {} }));
    await page.evaluate(() => window.afterStop.then(() => undefined));
    assert.equal(await page.evaluate(() => __n8nPushProbe.records.filter((entry) => entry.event === 'frame').length), 3);

    console.log(JSON.stringify({ ok: true, browser: await browser.version(), socketOpenedBeforeProbe: true, lateConstructorHookFrames: result.lateHookCount, existingSocketFrames: frames.length, textAndBinaryMetadata: true, payloadExcluded: true, listenersRemoved: true, records: result.records }, null, 2));
    peer.terminate();
  } finally {
    await browser?.close();
    for (const peer of wsServer.clients) peer.terminate();
    await new Promise((resolve) => wsServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
