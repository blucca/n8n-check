import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [sourcePath, fixturePath] = process.argv.slice(2);
if (!sourcePath || !fixturePath) throw new Error('Usage: node check.mjs anomaly.ts fixture.json');
const { detectAnomalies } = await import(pathToFileURL(sourcePath).href);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { baselineHours, recentHours } = fixture;
assert.equal(baselineHours, 162);
assert.equal(recentHours, 6);

// Caller-normalization control only: keep the immutable detector unchanged,
// and include the zero-run hours in the known elapsed baseline window.
function completeBaseline(rows) {
  const byHour = new Map(rows.map(row => [Date.parse(row.hour), row]));
  const start = Date.parse(fixture.baselineStart);
  return Array.from({ length: baselineHours }, (_, h) => {
    const time = start + h * 3_600_000;
    return byHour.get(time) ?? { hour: new Date(time).toISOString(), runs: 0, failures: 0, p95Ms: null };
  });
}
const results = {};
for (const [name, { baseline, recent }] of Object.entries(fixture.workflows)) {
  const original = detectAnomalies(baseline, recent, { recentHours });
  const normalized = detectAnomalies(completeBaseline(baseline), recent, { recentHours });
  const runs = baseline.reduce((n, b) => n + b.runs, 0);
  results[name] = {
    occupiedHours: baseline.length, elapsedHours: baselineHours, baselineRuns: runs,
    recentRuns: recent.reduce((n, b) => n + b.runs, 0),
    originalExpectedRuns: runs / Math.max(1, baseline.length) * recentHours,
    elapsedExpectedRuns: runs / baselineHours * recentHours,
    original, normalized,
  };
}
const kinds = value => value.map(a => a.kind);
assert.equal(results.daily_batch.occupiedHours, 7);
assert.equal(results.daily_batch.baselineRuns, 70);
assert.equal(results.daily_batch.recentRuns, 0);
assert.equal(results.daily_batch.originalExpectedRuns, 60);
assert.ok(Math.abs(results.daily_batch.elapsedExpectedRuns - 70 / 162 * 6) < 1e-12);
assert.deepEqual(kinds(results.daily_batch.original), ['silence']);
assert.deepEqual(kinds(results.daily_batch.normalized), []);
assert.deepEqual(kinds(results.steady_stopped.original), ['silence']);
assert.deepEqual(kinds(results.steady_stopped.normalized), ['silence']);
assert.deepEqual(results.steady_live.original, []);
assert.deepEqual(results.steady_live.normalized, []);
assert.deepEqual(results.no_history.original, []);
assert.deepEqual(results.no_history.normalized, []);
console.log(JSON.stringify({ status: 'REPRODUCED_FALSE_SILENCE', sourceScope: 'immutable detector + native PostgreSQL sparse GROUP BY fixture; no Next.js/ORM/client service run', serverVersion: fixture.serverVersion, now: fixture.now, baselineStart: fixture.baselineStart, recentStart: fixture.recentStart, baselineHours, recentHours, results }, null, 2));

// The product contract: a normal daily burst followed by its usual quiet
// window should not be reported as a normally busy workflow stopping.
assert.deepEqual(kinds(results.daily_batch.original), [], 'normal daily batch produced a false silence alert');
