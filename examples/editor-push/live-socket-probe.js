// In Chrome/Edge DevTools Console: queryObjects(WebSocket), then right-click
// its displayed array and Store as global variable. Paste this file and call
// observeN8nPushSockets(temp1), using the variable name DevTools gave you.
// Observe current sockets; rerun after reconnect. Keep only metadata.
window.observeN8nPushSockets = (objects) => {
  if (!Array.isArray(objects)) {
    throw new Error('Pass the array saved by DevTools Store as global variable.');
  }
  window.__n8nPushProbe?.stop();
  const sockets = objects.filter(
    (socket) => new URL(socket.url).pathname.endsWith('/push'),
  );
  const records = [];
  const detach = [];
  const record = (entry) => {
    records.push({ at: new Date().toISOString(), ...entry });
    console.log('[n8n push]', records[records.length - 1]);
  };
  sockets.forEach((socket, index) => {
    const id = index + 1;
    record({ event: 'attached', socket: id, pushRef: new URL(socket.url).searchParams.get('pushRef'), readyState: socket.readyState });
    const onMessage = async ({ data }) => {
      const text = typeof data === 'string'
        ? data
        : data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : (data.size ?? data.byteLength);
      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      const entry = { event: 'frame', socket: id, bytes, type: typeof body?.type === 'string' ? body.type : 'non-json' };
      for (const name of ['workflowId', 'executionId']) {
        const value = body?.data?.[name];
        if (typeof value === 'string' || typeof value === 'number') entry[name] = value;
      }
      record(entry);
    };
    const onClose = ({ code }) => record({ event: 'close', socket: id, code });
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    detach.push(() => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    });
  });
  window.__n8nPushProbe = {
    records,
    socketCount: sockets.length,
    stop() { detach.forEach((remove) => remove()); },
  };
  console.info(`Attached to ${sockets.length} existing push socket(s). Inspect __n8nPushProbe.records; rerun after reconnect; stop with __n8nPushProbe.stop().`);
  return { socketCount: sockets.length };
};
