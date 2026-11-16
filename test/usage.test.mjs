import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('operation counts use fixed labels, page-local dedup and privacy opt-outs', async t => {
  const keys = ['location', 'navigator', 'fetch'];
  const before = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => keys.forEach((key, i) => before[i] ?
    Object.defineProperty(globalThis, key, before[i]) : delete globalThis[key]));
  const calls = [];
  for (const [key, value] of Object.entries({
    location: { origin: 'https://blucca.github.io', search: '' }, navigator: {},
    fetch: (_url, request) => { calls.push(request); return Promise.resolve(); },
  })) Object.defineProperty(globalThis, key, { value, configurable: true });
  const { usage } = await import('../web/usage.mjs?client-test');
  usage('builder-open', 'page'); usage('builder-open', 'page');
  usage('download-editor', 'import');
  usage('private-filename.json', 'import'); usage('download-editor', 'private-node-name');
  assert.equal(calls.length, 2);
  const values = calls.map(call => JSON.parse(call.body));
  assert.deepEqual(Object.keys(values[0]).sort(), ['event', 'session', 'source']);
  assert.equal(values[0].session, values[1].session);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].referrerPolicy, 'no-referrer');
  location.search = '?usage=off'; usage('inspect-open', 'page');
  location.search = ''; navigator.doNotTrack = '1'; usage('inspect-open', 'page');
  navigator.doNotTrack = '0'; navigator.globalPrivacyControl = true; usage('inspect-open', 'page');
  assert.equal(calls.length, 2);
  navigator.globalPrivacyControl = false;
  Object.defineProperty(globalThis, 'fetch', { value: () => Promise.reject(new Error('offline')), configurable: true });
  assert.doesNotThrow(() => usage('inspect-open', 'page'));
  await new Promise(resolve => setImmediate(resolve));
});

test('real collector stores only the label protocol and enforces its expiry', async t => {
  const directory = resolve(import.meta.dirname, '../../../temp/round630/usage-test');
  mkdirSync(directory, { recursive: true });
  const log = resolve(directory, 'events.jsonl'); writeFileSync(log, '');
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../ops/usage-server.mjs')], {
    env: { ...process.env, PORT: '0', USAGE_LOG: log, USAGE_EXPIRES: new Date(Date.now() + 2500).toISOString() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', value => { output += value; const match = output.match(/ready on (\d+)/); if (match) resolve(match[1]); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Collector exited ${code}`)));
  });
  const url = `http://127.0.0.1:${port}`;
  const event = { event: 'download-editor', source: 'import', session: '12345678-1234-1234-1234-123456789012' };
  const post = (value, origin = 'https://blucca.github.io') => fetch(`${url}/event`, {
    method: 'POST', headers: { origin }, body: JSON.stringify(value),
  });
  assert.equal((await post(event)).status, 204);
  assert.equal((await post({ ...event, file: 'private.json' })).status, 400);
  assert.equal((await post({ ...event, event: 'private.json' })).status, 400);
  assert.equal((await post(event, 'https://example.org')).status, 403);
  const rows = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, [{ at: rows[0].at, ...event }]);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 2600));
  assert.equal((await post(event)).status, 410);
  assert.equal((await fetch(`${url}/health`)).status, 410);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});
