#!/usr/bin/env node
'use strict';

// Original, synthetic read-only pagination model. No n8n engine or destination.
// Run: node --max-old-space-size=128 run.js [--out EXISTING_DIRECTORY]
// --self-test runs isolated pure assertions, not the experiment or enumeration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SCOPE = 'demo-orders';
const LIMIT = 2;
const MAX_PAGES = 6;
const SNAPSHOT = 'S0';
const TARGET = 'C';
const UNIVERSE = ['A', 'B', 'C', 'D', 'E', 'F'];
const COUNT_ORACLE = Object.freeze({
  initialSubsets: 63, noOp: 63, deletion: 192, insertion: 186, exchange: 480,
  histories: 921, scansPerStrategy: 921,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const ids = (text) => text ? text.split(' ') : [];
const unique = (values) => [...new Set(values)].sort();
const missing = (required, observed) => required.filter((id) => !observed.includes(id));

// Predictions transcribed before execution from PROTOCOL.md, not observed runs.
// Columns: pages, totals, next cursors, final state, missing continuous IDs,
// missing final IDs, observed-but-finally-absent IDs, stable-count, last-count.
function prediction(pages, totals, next, final, continuousMissing, finalMissing,
  staleObserved, stableCount, lastCount) {
  return { pages: pages.map(ids), totals, next, final: ids(final),
    continuousMissing: ids(continuousMissing), finalMissing: ids(finalMissing),
    staleObserved: ids(staleObserved), stableCount, lastCount };
}
const SCENARIOS = [
  { name: 'offset_static_present', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: [], insert: [] },
    expected: prediction(['A B', 'C D'], [4, 4], [2, null], 'A B C D', '', '', '', true, true) },
  { name: 'offset_shift_present', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: [] },
    expected: prediction(['A B', 'D'], [4, 3], [2, null], 'B C D', 'C', 'C', 'A', false, true) },
  { name: 'offset_shift_absent', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['C'], insert: [] },
    expected: prediction(['A B', 'D'], [4, 3], [2, null], 'A B D', '', '', '', false, true) },
  { name: 'offset_churn_present', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: ['X'] },
    expected: prediction(['A B', 'D X'], [4, 4], [2, null], 'B C D X', 'C', 'C', 'A', true, true) },
  { name: 'offset_static_absent', mode: 'offset', initial: ids('A B D X'),
    transition: { remove: [], insert: [] },
    expected: prediction(['A B', 'D X'], [4, 4], [2, null], 'A B D X', '', '', '', true, true) },
  { name: 'snapshot_churn', mode: 'snapshot', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: ['X'] },
    expected: { ...prediction(['A B', 'C D'], [4, 4], [2, null], 'B C D X', '', 'X', 'A', true, true),
      snapshot: SNAPSHOT } },
  { name: 'keyset_churn', mode: 'keyset', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: ['X'] },
    expected: prediction(['A B', 'C D', 'X'], [4, 4, 4], ['B', 'D', null], 'B C D X', '', '', 'A', false, false) },
  { name: 'keyset_low_insert', mode: 'keyset', initial: ids('A B C D'),
    transition: { remove: [], insert: ['AA'] },
    expected: prediction(['A B', 'C D'], [4, 5], ['B', null], 'A AA B C D', '', 'AA', '', false, false) },
  { name: 'confirm_present', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: [] }, confirm: true,
    expected: { ...prediction(['A B', 'D'], [4, 3], [2, null], 'B C D', 'C', 'C', 'A', false, true),
      point: { status: 200, classification: 'present' } } },
  { name: 'confirm_absent', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['C'], insert: [] }, confirm: true,
    expected: { ...prediction(['A B', 'D'], [4, 3], [2, null], 'A B D', '', '', '', false, true),
      point: { status: 404, classification: 'absent_at_lookup_cut' } } },
  { name: 'confirm_error', mode: 'offset', initial: ids('A B C D'),
    transition: { remove: ['A'], insert: ['X'] }, confirm: true, pointError: true,
    expected: { ...prediction(['A B', 'D X'], [4, 4], [2, null], 'B C D X', 'C', 'C', 'A', true, true),
      point: { status: 503, classification: 'unknown' } } },
];

// Source-only membership operation. Inserts must have been absent initially.
function transitionState(initial, transition) {
  assert.equal(unique(initial).length, initial.length);
  for (const id of transition.remove) assert.ok(initial.includes(id));
  for (const id of transition.insert) assert.ok(!initial.includes(id));
  return unique(initial.filter((id) => !transition.remove.includes(id)).concat(transition.insert));
}

// Pure API projection. The source passes its state here; collectors never do.
function pagePayload(mode, current, snapshot, query) {
  assert.equal(query.scope, SCOPE);
  assert.equal(query.limit, LIMIT);
  const state = mode === 'snapshot' ? snapshot : current;
  if (mode === 'keyset') {
    const qualifying = state.filter((id) => query.after === null || id > query.after);
    const page = qualifying.slice(0, LIMIT);
    return { items: page.map((id) => ({ id })), total: state.length,
      nextAfter: qualifying.length > LIMIT ? page[page.length - 1] : null, scope: SCOPE };
  }
  assert.ok(Number.isInteger(query.offset) && query.offset >= 0);
  const body = { items: state.slice(query.offset, query.offset + LIMIT).map((id) => ({ id })),
    total: state.length, nextOffset: query.offset + LIMIT < state.length ? query.offset + LIMIT : null,
    scope: SCOPE };
  if (mode === 'snapshot') body.snapshot = SNAPSHOT;
  return body;
}

function parsePageRequest(mode, requestPath) {
  const url = new URL(requestPath, 'http://model.invalid'); // parsing only
  assert.equal(url.pathname, '/' + mode);
  return { scope: url.searchParams.get('scope'), limit: Number(url.searchParams.get('limit')),
    offset: Number(url.searchParams.get('offset')),
    after: url.searchParams.has('after') ? url.searchParams.get('after') : null };
}

// An isolated source owns truth. Only its response leaves through HTTP/read().
function makeSource(spec) {
  const initial = [...spec.initial].sort();
  let current = [...initial];
  let pages = 0;
  let applied = false;
  const journal = [{ kind: 'initial', state: [...current] }];
  function applyAfterFirstResponse() {
    assert.equal(pages, 1);
    assert.equal(applied, false);
    const before = [...current];
    current = transitionState(initial, spec.transition);
    applied = true;
    journal.push({ kind: 'transition_after_first_response', transition: copy(spec.transition),
      before, after: [...current] });
  }
  function page(mode, requestPath) {
    const query = parsePageRequest(mode, requestPath);
    const body = pagePayload(mode, current, initial, query);
    pages += 1;
    journal.push({ kind: 'page', page: pages, mode, requestPath, liveState: [...current],
      servedState: [...(mode === 'snapshot' ? initial : current)], response: copy(body) });
    return body;
  }
  function point(id) {
    const lookupCut = 'lookup-1';
    const present = current.includes(id);
    const status = spec.pointError ? 503 : present ? 200 : 404;
    const body = status === 200 ? { item: { id }, scope: SCOPE, lookupCut }
      : { error: status === 404 ? 'object_not_found' : 'service_unavailable', scope: SCOPE, lookupCut };
    journal.push({ kind: 'point_lookup', id, lookupCut, scope: SCOPE, state: [...current],
      sourcePresent: present, status, response: copy(body) });
    return { status, body };
  }
  return { page, point, applyAfterFirstResponse,
    truth: () => ({ initial: [...initial], transition: copy(spec.transition), transitionApplied: applied,
      final: [...current], snapshot: { id: SNAPSHOT, state: [...initial] }, journal: copy(journal) }) };
}

function makeHttpApi() {
  let activeSource = null;
  const server = http.createServer((req, res) => {
    try {
      assert.ok(activeSource, 'source must be selected internally');
      assert.equal(req.method, 'GET');
      const source = activeSource;
      const url = new URL(req.url, 'http://localhost');
      assert.equal(url.searchParams.get('scope'), SCOPE);
      const mode = url.pathname.slice(1);
      let response;
      if (mode === 'point') response = source.point(url.searchParams.get('id'));
      else {
        assert.ok(['offset', 'keyset', 'snapshot'].includes(mode));
        response = { status: 200, body: source.page(mode, req.url) };
        // finish fires after this response is sent, never in the middle of a read.
        const first = source.truth().journal.filter((event) => event.kind === 'page').length === 1;
        if (first) res.once('finish', source.applyAfterFirstResponse);
      }
      res.sendDate = false;
      res.statusCode = response.status;
      const raw = JSON.stringify(response.body);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', Buffer.byteLength(raw));
      res.setHeader('Connection', 'close');
      res.end(raw);
    } catch (error) {
      res.sendDate = false;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify({ error: 'model_error', message: error.message }));
    }
  });
  return { server, activate: (spec) => { activeSource = makeSource(spec); },
    truth: () => activeSource && activeSource.truth() };
}

function requestJson(origin, requestPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, origin);
    let request;
    const req = http.get(url, { agent: false, headers: { Accept: 'application/json', Connection: 'close' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          resolve({ request, response: { status: res.statusCode, statusMessage: res.statusMessage,
            httpVersion: res.httpVersion, rawHeaders: [...res.rawHeaders], rawBody, body: JSON.parse(rawBody) } });
        } catch (error) { reject(error); }
      });
    });
    request = { method: 'GET', url: url.href, path: requestPath, headers: { ...req.getHeaders() } };
    req.setTimeout(5000, () => req.destroy(new Error('localhost HTTP read timed out')));
    req.on('error', reject);
  });
}

// Shared collector for HTTP and finite in-process reads. No source truth argument.
function makeCollector(mode) {
  let offset = 0;
  let after = null;
  let done = false;
  let scope = null;
  let snapshot = null;
  const trace = [];
  return {
    done: () => done,
    requestPath: () => {
      assert.ok(trace.length < MAX_PAGES, 'stop before a seventh page request');
      if (mode === 'keyset') return '/keyset?scope=' + SCOPE
        + (after === null ? '' : '&after=' + encodeURIComponent(after)) + '&limit=' + LIMIT;
      return '/' + mode + '?scope=' + SCOPE + '&offset=' + offset + '&limit=' + LIMIT;
    },
    accept: (exchange) => {
      assert.ok(!done, 'no read after terminal cursor');
      assert.ok(trace.length < MAX_PAGES, 'page budget exceeded');
      assert.equal(exchange.response.status, 200);
      const body = exchange.response.body;
      assert.equal(body.scope, SCOPE);
      assert.ok(Array.isArray(body.items) && body.items.length <= LIMIT);
      assert.ok(Number.isInteger(body.total) && body.total >= 0);
      const pageIds = body.items.map((item) => { assert.equal(typeof item.id, 'string'); return item.id; });
      assert.deepEqual(pageIds, unique(pageIds));
      scope = body.scope;
      if (mode === 'snapshot') {
        assert.equal(typeof body.snapshot, 'string');
        if (snapshot === null) snapshot = body.snapshot;
        assert.equal(body.snapshot, snapshot);
      }
      if (mode === 'keyset') {
        assert.ok(pageIds.every((id) => after === null || id > after));
        done = body.nextAfter === null;
        if (!done) {
          assert.equal(body.nextAfter, pageIds[pageIds.length - 1]);
          assert.ok(after === null || body.nextAfter > after);
          after = body.nextAfter;
        }
      } else {
        done = body.nextOffset === null;
        if (!done) { assert.equal(body.nextOffset, offset + LIMIT); offset = body.nextOffset; }
      }
      trace.push(copy(exchange));
    },
    finish: () => {
      assert.ok(done, 'scan must reach explicit terminal cursor within six pages');
      const observedIds = trace.flatMap((exchange) => exchange.response.body.items.map((item) => item.id));
      const uniqueObservedIds = unique(observedIds);
      const totals = trace.map((exchange) => exchange.response.body.total);
      return { trace: copy(trace), pageCount: trace.length, terminal: true, scope,
        observedIds, uniqueObservedIds, target: TARGET, targetObserved: observedIds.includes(TARGET),
        weakHeuristics: {
          duplicateFree: observedIds.length === uniqueObservedIds.length,
          stableTotalsAndUniqueCountMatch: totals.every((n) => n === totals[0]) && uniqueObservedIds.length === totals[0],
          uniqueCountMatchesLastTotal: uniqueObservedIds.length === totals[totals.length - 1],
          missingIdAbsenceCandidate: !observedIds.includes(TARGET),
        },
        coverageStatement: mode === 'snapshot'
          ? { kind: 'snapshot_traversal', snapshot, scope, endStateCoverageAsserted: false }
          : { kind: mode === 'keyset' ? 'immutable_keyset_terminal_traversal' : 'live_offset_terminal_traversal',
            scope, endStateCoverageAsserted: false } };
    },
  };
}

async function collectHttp(origin, mode) {
  const collector = makeCollector(mode);
  while (!collector.done()) collector.accept(await requestJson(origin, collector.requestPath()));
  return collector.finish();
}

function classifyPoint(exchange, target) {
  const { status, body } = exchange.response;
  const qualified = body.scope === SCOPE && typeof body.lookupCut === 'string';
  let classification = 'unknown';
  if (qualified && status === 200 && body.item && body.item.id === target) classification = 'present';
  if (qualified && status === 404 && body.error === 'object_not_found') classification = 'absent_at_lookup_cut';
  return { target, classification, status, scope: body.scope || null, lookupCut: body.lookupCut || null,
    authority: classification === 'unknown' ? 'no_membership_result' : 'membership_at_lookup_response_cut' };
}

// Evaluation sees truth only after the collector has completed.
function evaluate(initial, final, scan) {
  const continuous = initial.filter((id) => final.includes(id));
  return { initial: [...initial], final: [...final], continuous,
    missingContinuous: missing(continuous, scan.uniqueObservedIds),
    missingInitial: missing(initial, scan.uniqueObservedIds),
    missingFinal: missing(final, scan.uniqueObservedIds),
    observedAbsentFromFinal: missing(scan.uniqueObservedIds, final),
    continuousCovered: missing(continuous, scan.uniqueObservedIds).length === 0,
    targetFinalPresent: final.includes(TARGET) };
}

function verifyFixed(spec, scan, confirmation, truth) {
  const expected = spec.expected;
  const evaluation = evaluate(truth.initial, truth.final, scan);
  assert.deepEqual(truth.initial, spec.initial);
  assert.deepEqual(truth.transition, spec.transition);
  assert.equal(truth.transitionApplied, true);
  assert.deepEqual(truth.final, expected.final);
  assert.deepEqual(scan.trace.map((entry) => entry.response.body.items.map((item) => item.id)), expected.pages);
  assert.deepEqual(scan.trace.map((entry) => entry.response.body.total), expected.totals);
  assert.deepEqual(scan.trace.map((entry) => entry.response.body[spec.mode === 'keyset' ? 'nextAfter' : 'nextOffset']), expected.next);
  assert.deepEqual(evaluation.missingContinuous, expected.continuousMissing);
  assert.deepEqual(evaluation.missingFinal, expected.finalMissing);
  assert.deepEqual(evaluation.observedAbsentFromFinal, expected.staleObserved);
  assert.equal(scan.weakHeuristics.stableTotalsAndUniqueCountMatch, expected.stableCount);
  assert.equal(scan.weakHeuristics.uniqueCountMatchesLastTotal, expected.lastCount);
  const pageTruth = truth.journal.filter((event) => event.kind === 'page');
  assert.equal(pageTruth.length, expected.pages.length);
  pageTruth.forEach((event, index) => {
    assert.deepEqual(event.liveState, index === 0 ? spec.initial : expected.final);
    assert.deepEqual(event.servedState, spec.mode === 'snapshot' ? spec.initial : event.liveState);
    assert.deepEqual(event.response, scan.trace[index].response.body);
  });
  if (spec.mode === 'snapshot') {
    assert.deepEqual(scan.coverageStatement, { kind: 'snapshot_traversal', snapshot: 'S0', scope: SCOPE,
      endStateCoverageAsserted: false });
    assert.deepEqual(evaluation.missingInitial, []);
  }
  if (spec.confirm) {
    assert.equal(confirmation.result.status, expected.point.status);
    assert.equal(confirmation.result.classification, expected.point.classification);
    assert.equal(confirmation.result.scope, SCOPE);
    assert.equal(confirmation.result.lookupCut, 'lookup-1');
    const lookup = truth.journal.filter((event) => event.kind === 'point_lookup');
    assert.equal(lookup.length, 1);
    assert.deepEqual(lookup[0].state, expected.final);
    assert.equal(lookup[0].sourcePresent, expected.final.includes(TARGET));
    assert.deepEqual(lookup[0].response, confirmation.exchange.response.body);
  } else assert.equal(confirmation, null);
  return { ...evaluation, frozenPredictionPassed: true };
}

function verifyTranscriptPairs(groups) {
  const byName = Object.fromEntries(groups.map((group) => [group.name, group]));
  const pairs = [['offset_shift_present', 'offset_shift_absent'], ['offset_churn_present', 'offset_static_absent']];
  const checks = [];
  for (const [leftName, rightName] of pairs) {
    const left = byName[leftName];
    const right = byName[rightName];
    // Entire saved HTTP exchanges: no URL, request, header or body field removed.
    assert.deepEqual(left.scan.trace, right.scan.trace);
    assert.notEqual(left.evaluation.targetFinalPresent, right.evaluation.targetFinalPresent);
    checks.push({ left: leftName, right: rightName, completeExchangesIdentical: true,
      targetFinalMembershipDifferent: true, comparedFields: 'all_saved_request_and_response_fields' });
  }
  for (const [confirmation, scan] of [['confirm_present', 'offset_shift_present'],
    ['confirm_absent', 'offset_shift_absent'], ['confirm_error', 'offset_churn_present']]) {
    assert.deepEqual(byName[confirmation].scan.trace, byName[scan].scan.trace);
  }
  return checks;
}

function finiteScan(mode, initial, transition) {
  const source = makeSource({ initial, transition });
  const collector = makeCollector(mode);
  let readCount = 0;
  while (!collector.done()) {
    const requestPath = collector.requestPath();
    const body = source.page(mode, requestPath);
    readCount += 1;
    // Synchronous stand-in for the response-finish boundary, not HTTP evidence.
    if (readCount === 1) source.applyAfterFirstResponse();
    collector.accept({ request: { method: 'GET', path: requestPath }, response: { status: 200, body } });
  }
  const scan = collector.finish();
  const truth = source.truth();
  return { scan, evaluation: evaluate(truth.initial, truth.final, scan), truth };
}

function enumerateFinite(out, progress) {
  const counts = { initialSubsets: 0, noOp: 0, deletion: 0, insertion: 0, exchange: 0, histories: 0 };
  const seen = new Set();
  const offsetCounterexamples = [];
  const keysetCounterexamples = [];
  let maxOffsetPages = 0;
  let maxKeysetPages = 0;
  const historyFile = path.join(out, 'finite-histories.jsonl');
  fs.writeFileSync(historyFile, '');
  for (let mask = 1; mask < (1 << UNIVERSE.length); mask += 1) {
    const initial = UNIVERSE.filter((id, index) => mask & (1 << index));
    const absentInitially = UNIVERSE.filter((id) => !initial.includes(id));
    counts.initialSubsets += 1;
    const transitions = [{ kind: 'noOp', remove: [], insert: [] }];
    for (const remove of initial) transitions.push({ kind: 'deletion', remove: [remove], insert: [] });
    for (const insert of absentInitially) transitions.push({ kind: 'insertion', remove: [], insert: [insert] });
    for (const remove of initial) for (const insert of absentInitially) {
      transitions.push({ kind: 'exchange', remove: [remove], insert: [insert] });
    }
    for (const transition of transitions) {
      const historyId = mask + ':' + transition.remove.join('') + ':' + transition.insert.join('');
      assert.ok(!seen.has(historyId), 'duplicate history');
      seen.add(historyId);
      counts[transition.kind] += 1;
      counts.histories += 1;
      let offset;
      let keyset;
      try {
        offset = finiteScan('offset', initial, transition);
        keyset = finiteScan('keyset', initial, transition);
      } catch (error) {
        error.history = { historyId, initial, transition };
        throw error;
      }
      assert.deepEqual(offset.truth.final, keyset.truth.final);
      maxOffsetPages = Math.max(maxOffsetPages, offset.scan.pageCount);
      maxKeysetPages = Math.max(maxKeysetPages, keyset.scan.pageCount);
      const record = { historyId, initial, transition, final: offset.truth.final,
        continuous: offset.evaluation.continuous,
        offset: { pageCount: offset.scan.pageCount, observedIds: offset.scan.observedIds,
          missingContinuous: offset.evaluation.missingContinuous, covered: offset.evaluation.continuousCovered },
        keyset: { pageCount: keyset.scan.pageCount, observedIds: keyset.scan.observedIds,
          missingContinuous: keyset.evaluation.missingContinuous, covered: keyset.evaluation.continuousCovered } };
      fs.appendFileSync(historyFile, JSON.stringify(record) + '\n');
      if (!offset.evaluation.continuousCovered) offsetCounterexamples.push({ ...record,
        offsetTrace: offset.scan.trace, sourceJournal: offset.truth.journal });
      if (!keyset.evaluation.continuousCovered) keysetCounterexamples.push({ ...record,
        keysetTrace: keyset.scan.trace, sourceJournal: keyset.truth.journal });
      if (counts.histories % 100 === 0) progress(counts.histories);
    }
  }
  const summary = { universe: UNIVERSE, pageSize: LIMIT, maxPagesAllowed: MAX_PAGES,
    countOracle: COUNT_ORACLE, counts, uniqueHistories: seen.size,
    offsetScans: counts.histories, keysetScans: counts.histories, maxOffsetPages, maxKeysetPages,
    offsetCounterexamples: offsetCounterexamples.length, keysetCounterexamples: keysetCounterexamples.length,
    coverageCut: 'continuous_initial_ids_under_single_transition_no_resurrection',
    historyFile: 'finite-histories.jsonl', counterexampleFile: 'offset-counterexamples.json' };
  writeJson(out, 'offset-counterexamples.json', offsetCounterexamples);
  writeJson(out, 'keyset-counterexamples.json', keysetCounterexamples);
  writeJson(out, 'finite-summary.json', summary);
  for (const field of ['initialSubsets', 'noOp', 'deletion', 'insertion', 'exchange', 'histories']) {
    assert.equal(counts[field], COUNT_ORACLE[field], 'frozen history-count oracle: ' + field);
  }
  assert.equal(seen.size, COUNT_ORACLE.histories);
  assert.ok(maxOffsetPages <= MAX_PAGES && maxKeysetPages <= MAX_PAGES);
  assert.ok(offsetCounterexamples.length > 0, 'offset must exhibit a continuous-ID counterexample');
  assert.equal(keysetCounterexamples.length, 0, 'immutable keyset continuous-ID coverage');
  return summary;
}

function writeJson(out, name, value) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
}

function pureSelfTest() {
  assert.deepEqual(pagePayload('offset', ['P', 'Q', 'R'], [], { scope: SCOPE, offset: 0, limit: 2 }),
    { items: [{ id: 'P' }, { id: 'Q' }], total: 3, nextOffset: 2, scope: SCOPE });
  const point = (status, body) => ({ response: { status, body: { scope: SCOPE, lookupCut: 'unit-cut', ...body } } });
  assert.equal(classifyPoint(point(200, { item: { id: 'Z' } }), 'Z').classification, 'present');
  assert.equal(classifyPoint(point(404, { error: 'object_not_found' }), 'Z').classification, 'absent_at_lookup_cut');
  assert.equal(classifyPoint(point(503, { error: 'service_unavailable' }), 'Z').classification, 'unknown');
  assert.equal(COUNT_ORACLE.noOp + COUNT_ORACLE.deletion + COUNT_ORACLE.insertion + COUNT_ORACLE.exchange,
    COUNT_ORACLE.histories);
  process.stdout.write(JSON.stringify({ kind: 'pure_self_test',
    checks: ['pure_page_slice', 'point_200', 'point_404', 'point_503', 'analytic_count_sum'],
    passed: true, officialHttpGroupsRun: 0, finiteHistoriesRun: 0 }) + '\n');
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--self-test') return { selfTest: true };
  if (args.length === 0) return { out: path.join(__dirname, 'results'), makeDefault: true };
  if (args.length === 2 && args[0] === '--out') {
    const out = path.resolve(args[1]);
    assert.ok(fs.existsSync(out) && fs.statSync(out).isDirectory(), '--out requires an existing directory');
    return { out, makeDefault: false };
  }
  throw new Error('Usage: node --max-old-space-size=128 run.js [--out EXISTING_DIRECTORY | --self-test]');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return pureSelfTest();
  const out = options.out;
  if (options.makeDefault) fs.mkdirSync(out, { recursive: true });
  // Preserve a previous positive or failed experiment. Select a fresh directory.
  for (const file of ['results.json', 'progress.json', 'frozen-oracles.json', 'finite-histories.jsonl']) {
    assert.ok(!fs.existsSync(path.join(out, file)), 'previous evidence exists: ' + file);
  }
  const report = { status: 'running', scope: SCOPE, startedAt: new Date().toISOString(),
    provenance: { source: 'original synthetic IDs and frozen PROTOCOL.md; see ORACLES.md',
      sourceTruthPassedToCollectors: false },
    groups: [], identicalTranscriptChecks: [], finite: null,
    modelBoundary: 'read_only_API_protocol_model; not_n8n_engine; no_destination_write_or_deletion',
    monotoneOrderArgument: 'A continuously alive immutable key remaining above the cursor is eligible for every subsequent read. '
      + 'A nonterminal read advances to its last returned key, so advancing past that key must return it first. '
      + 'At a terminal read every remaining eligible key is returned. Thus continuous initial keys are covered under '
      + 'this fixed scope and single-transition, no-resurrection model. Keys inserted below a prior cursor and final freshness have separate cuts.' };
  const progress = (phase, details = {}) => writeJson(out, 'progress.json',
    { status: report.status, phase, updatedAt: new Date().toISOString(), completedGroups: report.groups.length, ...details });
  writeJson(out, 'frozen-oracles.json', { provenance: 'defined in source before any HTTP or finite execution',
    scenarios: SCENARIOS, finiteCountOracle: COUNT_ORACLE });
  writeJson(out, 'results.json', report);
  progress('starting_loopback_server');
  const api = makeHttpApi();
  let listening = false;
  try {
    await new Promise((resolve, reject) => {
      api.server.once('error', reject);
      api.server.listen(0, '127.0.0.1', resolve);
    });
    listening = true;
    const address = api.server.address();
    const origin = 'http://127.0.0.1:' + address.port;
    report.httpOrigin = origin;
    for (const spec of SCENARIOS) {
      api.activate(spec);
      progress('http_group', { activeGroup: spec.name });
      const scan = await collectHttp(origin, spec.mode);
      let confirmation = null;
      if (spec.confirm) {
        const exchange = await requestJson(origin, '/point?scope=' + SCOPE + '&id=' + TARGET);
        confirmation = { exchange, result: classifyPoint(exchange, TARGET) };
      }
      const truth = api.truth();
      // Persist observed evidence before an assertion can fail.
      const group = { name: spec.name, mode: spec.mode, scan, confirmation, sourceTruth: truth };
      report.groups.push(group);
      writeJson(out, 'results.json', report);
      group.evaluation = verifyFixed(spec, scan, confirmation, truth);
      writeJson(out, 'results.json', report);
    }
    report.identicalTranscriptChecks = verifyTranscriptPairs(report.groups);
    progress('finite_enumeration', { completedHistories: 0 });
    report.finite = enumerateFinite(out, (count) => progress('finite_enumeration', { completedHistories: count }));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message, stack: error.stack,
      finiteHistory: error.history || null, activeSourceTruth: api.truth() };
    writeJson(out, 'failure.json', report.failure);
    throw error;
  } finally {
    if (listening) await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
    report.serverClosed = !api.server.listening;
    report.finishedAt = new Date().toISOString();
    report.resources = { maxRssKiB: process.resourceUsage().maxRSS, memoryUsageBytes: process.memoryUsage(),
      nodeVersion: process.version, execArgv: process.execArgv };
    writeJson(out, 'results.json', report);
    progress(report.status === 'passed' ? 'complete' : 'failed', { serverClosed: report.serverClosed });
  }
  process.stdout.write(JSON.stringify({ status: report.status, httpGroups: report.groups.length,
    finiteHistories: report.finite.counts.histories, offsetCounterexamples: report.finite.offsetCounterexamples,
    keysetCounterexamples: report.finite.keysetCounterexamples, serverClosed: report.serverClosed, out }) + '\n');
}

main().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
