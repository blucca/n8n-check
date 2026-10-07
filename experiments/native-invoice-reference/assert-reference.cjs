'use strict';
const { isDeepStrictEqual } = require('node:util');

function atPath(value, path) {
  return path.split('.').reduce((entry, key) => entry?.[key], value);
}

function isSubset(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((value, index) => isSubset(actual[index], value));
  }
  if (expected !== null && typeof expected === 'object') {
    return actual !== null && typeof actual === 'object' &&
      Object.entries(expected).every(([key, value]) =>
        Object.hasOwn(actual, key) && isSubset(actual[key], value));
  }
  return isDeepStrictEqual(actual, expected);
}

// Apply the checks in the reference file. Keep the draft format local to this experiment.
async function assertReference(testCase, run, requests, Expression) {
  const checks = [];
  const expression = new Expression('UTC');
  return await expression.withIsolate(async () => {
  const add = (name, expected, actual, matches = isDeepStrictEqual(actual, expected)) => {
    checks.push({ name, passed: matches, expected, actual: actual === undefined ? null : actual });
  };
  function assertExpression(name, source, data) {
    try {
      add(name, true, expression.resolveSimpleParameterValue(source, data));
    } catch (error) {
      add(name, true, { error: error.message }, false);
    }
  }
  function pluck(name, values, spec) {
    add(`${name} pluck ${spec.path}`, spec.equals, values.map((value) => atPath(value, spec.path)));
  }
  const expect = testCase.expect;
  if (expect.status) add('workflow status', expect.status, run.status);
  const runData = run.data?.resultData?.runData ?? {};
  for (const [node, spec] of Object.entries(expect.nodes ?? {})) {
    const runs = runData[node] ?? [];
    const items = runs.flatMap((entry) => entry.data?.main?.[0] ?? []);
    if (spec.executed !== undefined) add(`${node} executed`, spec.executed, runs.length > 0);
    if (spec.count !== undefined) add(`${node} item count`, spec.count, items.length);
    if (spec.pluck) pluck(node, items, spec.pluck);
    if (spec.assert) {
      add(`${node} assertion has items`, true, items.length > 0);
      items.forEach((item, index) => assertExpression(`${node} item ${index + 1}`, spec.assert, { $json: item.json }));
    }
  }
  for (const spec of expect.requests ?? []) {
    const calls = requests.filter((request) => request.node === spec.node);
    if (spec.count !== undefined) add(`${spec.node} request count`, spec.count, calls.length);
    if (spec.pluck) pluck(`${spec.node} requests`, calls, spec.pluck);
    if (spec.calls) {
      add(`${spec.node} declared calls`, spec.calls.length, calls.length);
      spec.calls.forEach((expected, index) => {
        const actual = calls[index];
        for (const [field, value] of Object.entries(expected)) {
          if (field === 'assert') {
            assertExpression(`${spec.node} call ${index + 1} expression`, value, { $request: actual });
          } else {
            add(`${spec.node} call ${index + 1} ${field}`, value, actual?.[field], isSubset(actual?.[field], value));
          }
        }
      });
    }
    if (spec.assert) {
      add(`${spec.node} assertion has calls`, true, calls.length > 0);
      calls.forEach((call, index) => assertExpression(`${spec.node} call ${index + 1} expression`, spec.assert, { $request: call }));
    }
  }
  return { name: testCase.name, passed: checks.every((check) => check.passed), checks };
  });
}

module.exports = { assertReference };
