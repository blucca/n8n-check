import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildLocalBundle, localBundleFiles, RUNNER_SHA256, RUNNER_URL } from '../src/local-bundle.mjs';

const options = { workflow: [{ name: '发票 🧾', nodes: [], connections: {} }], caseFile: { name: 'one', input: { node: 'Source', items: [] } }, n8nVersion: '2.41.7' };

test('local ZIP preserves JSON and has consistent local/central entries', () => {
  const zip = buildLocalBundle(options);
  assert.ok(zip instanceof Uint8Array);
  assert.deepEqual(zip, buildLocalBundle(options));
  const view = new DataView(zip.buffer);
  const u16 = at => view.getUint16(at, true);
  const u32 = at => view.getUint32(at, true);
  const decode = bytes => new TextDecoder().decode(bytes);
  const files = {};
  const entries = [];
  let offset = 0;
  while (u32(offset) === 0x04034b50) {
    assert.equal(u16(offset + 6), 0x800);
    assert.equal(u16(offset + 8), 0);
    const length = u32(offset + 18);
    const nameLength = u16(offset + 26);
    const name = decode(zip.slice(offset + 30, offset + 30 + nameLength));
    const bytes = zip.slice(offset + 30 + nameLength, offset + 30 + nameLength + length);
    // Independent polynomial long-division CRC calculation.
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal(u32(offset + 14), (crc ^ 0xffffffff) >>> 0);
    files[name] = decode(bytes);
    entries.push({ offset, nameLength });
    offset += 30 + nameLength + length;
  }
  const centralOffset = offset;
  for (const entry of entries) {
    assert.equal(u32(offset), 0x02014b50);
    assert.equal(u32(offset + 42), entry.offset);
    offset += 46 + entry.nameLength;
  }
  assert.equal(u32(offset), 0x06054b50);
  assert.equal(u16(offset + 10), 4);
  assert.equal(u32(offset + 16), centralOffset);
  assert.equal(offset + 22, zip.length);
  assert.deepEqual(files, localBundleFiles(options));
  assert.deepEqual(JSON.parse(files['workflow.json']), options.workflow);
  assert.deepEqual(JSON.parse(files['case.json']), options.caseFile);
});

test('version accepts exact releases and rejects shell syntax and mutable tags', () => {
  for (const version of ['2.41.7', '2.41.7-beta.2']) assert.ok(buildLocalBundle({ ...options, n8nVersion: version }).length);
  for (const version of ['latest', '2', '02.41.7', '2.41.7\necho pwned', '2.41.7;echo pwned', '2.41.7$(id)', '', null]) {
    assert.throws(() => buildLocalBundle({ ...options, n8nVersion: version }), /exact n8n release/);
  }
});

test('portable shell pins the runner, uses isolated read-only execution and maps status', () => {
  const script = localBundleFiles(options)['run.sh'];
  const result = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(script.includes(RUNNER_SHA256));
  assert.ok(script.includes(RUNNER_URL));
  assert.match(script, /createHash\('sha256'\)/);
  assert.match(script, /--network none --user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(script, /target=\/inputs\/workflow.json,readonly/);
  assert.match(script, /target=\/inputs\/case.json,readonly/);
  assert.match(script, /source=\$ROOT\/results,target=\/results/);
  assert.match(script, /case "\$CODE" in 0\|1\|2\) exit "\$CODE"/);
  assert.ok(script.indexOf('rm -f results/report.json') < script.indexOf('docker run'));
  assert.match(script, /ADD runner.tgz \/opt\/n8n-check\//);
  assert.match(script, /package\/bin\/n8n-check.mjs/);
});
