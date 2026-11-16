// Private operation log; no accounts, workflow data, IPs or request-header logs.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { usageEvents } from '../web/usage.mjs';

const expires = Date.parse(process.env.USAGE_EXPIRES);
const log = process.env.USAGE_LOG;
if (!Number.isFinite(expires) || !log) throw new Error('Set USAGE_EXPIRES and USAGE_LOG.');

const server = createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(Date.now() < expires ? 200 : 410);
    res.end(JSON.stringify({ accepting: Date.now() < expires, expires: new Date(expires).toISOString() }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/event') { res.writeHead(404); res.end(); return; }
  if (req.headers.origin !== 'https://blucca.github.io') { res.writeHead(403); res.end(); return; }
  res.setHeader('access-control-allow-origin', 'https://blucca.github.io');
  if (Date.now() >= expires) { res.writeHead(410); res.end(); return; }
  let body = '', bytes = 0;
  // The fixed three-label protocol fits in 512 bytes. Larger bodies are discarded.
  req.on('data', chunk => { bytes += chunk.length; if (bytes <= 512) body += chunk; });
  req.on('end', () => {
    if (bytes > 512) { res.writeHead(413); res.end(); return; }
    try {
      const value = JSON.parse(body);
      const { event, source, session } = value;
      if (Object.keys(value).length !== 3 || !usageEvents.has(event) ||
          !['page', 'example', 'import'].includes(source) ||
          typeof session !== 'string' || !/^[a-f0-9-]{36}$/.test(session)) {
        res.writeHead(400); res.end(); return;
      }
      appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event, source, session }) + '\n');
      res.writeHead(204); res.end();
    } catch { res.writeHead(400); res.end(); }
  });
});
server.listen(Number(process.env.PORT || 17630), '127.0.0.1', () =>
  console.log(`Usage collector ready on ${server.address().port}; expires ${new Date(expires).toISOString()}`));
