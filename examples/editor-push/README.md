# Observe an already-open n8n push socket

Your form execution succeeds, but the editor keeps waiting. This small Chrome/Edge DevTools probe records the push frames arriving on the editor's **existing** connections. It needs only the editor and your browser.

## Use it

1. Open the n8n editor's DevTools Console. Select the editor's JavaScript context and let `/rest/push` connect. If you previously replaced `window.WebSocket`, reload the editor first.
2. Run `queryObjects(WebSocket)`. Right-click the displayed array and select **Store as global variable**. DevTools assigns a name such as `temp1`.
3. Paste [live-socket-probe.js](./live-socket-probe.js), then run `observeN8nPushSockets(temp1)` with your assigned variable name. Its `attached` records give each socket's `pushRef` and `readyState` (`1` is open).
4. Execute your workflow and submit its test form. Inspect the metadata:

   ```js
   console.table(__n8nPushProbe.records);
   ```

5. Copy the report when needed, then remove the listeners:

   ```js
   copy(JSON.stringify(__n8nPushProbe.records, null, 2));
   __n8nPushProbe.stop();
   ```

A `frame` record means that socket received a browser `MessageEvent`. Look for `testWebhookReceived` and compare its workflow/execution IDs with the run you submitted. The report contains timing, frame size, type and IDs; message bodies remain outside the report.

A `close` record marks the end of an observed connection. Wait for the editor to reconnect, then rerun the probe. Its scope is the sockets present at attachment time in the selected context. `socketCount: 0` directs you back to that context and the current connection.

## Why observe existing sockets?

A constructor hook installed after the editor connects observes future sockets. Submitting a form normally uses the existing socket. This probe attaches listeners directly to those objects, without replacing the constructor or opening another connection.

In n8n **2.47.5**, [`AbstractPush.sendTo`](https://github.com/n8n-io/n8n/blob/n8n%402.47.5/packages/cli/src/push/abstract.push.ts#L79-L93) writes `Pushed to frontend` before calling the connection's send method. [`WebSocketPush`](https://github.com/n8n-io/n8n/blob/n8n%402.47.5/packages/cli/src/push/websocket.push.ts#L75-L77) uses `connection.send(data, options)` without a completion callback. These logs mark the server's dispatch attempt. This probe adds the browser-receipt observation. If that observation stays empty on an open, unchanged connection, the next measurement is the server's send callback and socket state for the same `pushRef`.

The concrete case is [tolani-co's Form Trigger report](https://github.com/n8n-io/n8n/issues/43759): manual mode and matching workflow ID, server dispatch logs, HTTP 101, and an empty browser Messages tab. The deployment's own probe results are the next input.

The discovery steps use Chrome's [Console utilities](https://developer.chrome.com/docs/devtools/console/utilities#queryObjects-function) and [Store as global variable](https://developer.chrome.com/docs/devtools/console/javascript). Use the variable name shown in your Console.

## Recorded check

On 2026-11-14, **Chromium 153.0.8010.12 / ws 8.20.1** observed a real loopback socket that was already open. The late constructor hook observed **0** frames; this probe recorded **3**: text JSON, binary JSON and a non-JSON binary control. Workflow/execution IDs survived, the synthetic private body stayed outside the report, and removing listeners stopped later capture. [Recorded metadata](./observed-results.json).

For a developer replay, reuse an installed Chromium, Playwright and `ws`:

```sh
NODE_PATH=/path/to/node_modules CHROME_PATH=/path/to/chromium node verify.cjs
```

Have metadata from your own failing run? [Send the n8n version and report](mailto:belgialucca@gmail.com?subject=n8n%20editor%20push%20metadata).
