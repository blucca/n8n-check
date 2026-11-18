import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';

export async function startMock(spec) {
  const requests = [];
  const counts = new Map();
  const errors = [];
  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 1024 * 1024) {
          errors.push('Mock request body exceeded 1 MiB');
          return send(413, { error: 'Mock request body limit' });
        }
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const match = url.pathname.match(/^\/(\d+)(\/.*)$/);
      const mockIndex = match ? Number(match[1]) : -1;
      const mock = spec.mocks[mockIndex];
      const path = (match?.[2] ?? url.pathname) + url.search;
      const routeIndex = mock?.routes.findIndex(route => route.method === req.method && route.path === path) ?? -1;
      const route = mock?.routes[routeIndex];
      let body = raw;
      try { body = raw ? JSON.parse(raw) : null; } catch {}
      const record = { node: mock?.node ?? null, method: req.method, path, body, matched: Boolean(route) };
      const key = `${mockIndex}:${routeIndex}`;
      const sequence = counts.get(key) ?? 0;
      counts.set(key, sequence + 1);
      if (requests.length >= (spec.maxRequests ?? 100)) {
        if (!errors.includes('Mock request count cap reached')) errors.push('Mock request count cap reached');
        return send(429, { error: 'Mock request count cap reached' });
      }
      requests.push(record);
      if (!route) {
        record.status = 404;
        return send(404, { error: 'Unexpected mock request', method: req.method, path });
      }
      const response = route.responses[Math.min(sequence, route.responses.length - 1)];
      record.status = response.status;
      record.response = response.json;
      send(response.status, response.json, response.headers);
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) send(500, { error: 'Mock server error' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
    checks() {
      const checks = [{ name: 'mock: all requests match routes', passed: requests.every(r => r.matched), actual: requests.filter(r => !r.matched) }];
      checks.push({ name: 'mock: request limits and server', passed: errors.length === 0, actual: errors });
      for (const mock of spec.mocks) for (const route of mock.routes) {
        const observed = requests.filter(r => r.node === mock.node && r.method === route.method && r.path === route.path);
        const prefix = `${mock.node}: ${route.method} ${route.path}`;
        checks.push({ name: `${prefix} request count`, passed: observed.length === route.expect.count, expected: route.expect.count, actual: observed.length });
        if (route.expect.bodies !== undefined) checks.push({ name: `${prefix} request bodies`, passed: isDeepStrictEqual(observed.map(r => r.body), route.expect.bodies), expected: route.expect.bodies, actual: observed.map(r => r.body) });
      }
      return checks;
    },
  };
}
