import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareWorkflow, validateCase } from '../src/workflow.mjs';
import { startMock } from '../src/mock.mjs';
import { executionFrom, executionChecks, junit } from '../src/report.mjs';
import { runtimeEnv, command } from '../src/runner.mjs';

const workflow = JSON.parse(await readFile(new URL('../examples/object-body/fixed.json', import.meta.url)));
const fixture = JSON.parse(await readFile(new URL('../examples/object-body/case.json', import.meta.url)));
const copy = value => structuredClone(value);

test('prepares real downstream nodes, fresh identity and synthetic input', () => {
  const source = copy(workflow);
  source.pinData = { Render: [{ json: { fake: true } }] };
  source.staticData = { secret: true };
  const { workflow: result, omittedNodes } = prepareWorkflow(source, fixture, 'http://127.0.0.1:1234');
  assert.deepEqual(omittedNodes, ['Start']);
  assert.equal(result.nodes.find(n => n.name === 'Fixture').type, 'n8n-nodes-base.code');
  assert.equal(result.nodes.find(n => n.name === 'Render').parameters.jsonBody, workflow.nodes[2].parameters.jsonBody);
  assert.equal(result.nodes.find(n => n.name === 'Render').parameters.url, 'http://127.0.0.1:1234/0/renders');
  assert.equal(result.pinData, undefined); assert.equal(result.staticData, undefined);
  assert.equal(source.nodes[2].parameters.url, 'https://api.example.com/renders');
});

test('single-workflow CLI array exports are supported', () => {
  assert.equal(prepareWorkflow([workflow], fixture, 'http://127.0.0.1:1234').workflow.nodes.length, 3);
  assert.throws(() => prepareWorkflow([workflow, workflow], fixture, ''), /multiple workflows/);
});

test('credential references are removed at mocked HTTP boundary', () => {
  const source = copy(workflow); source.nodes[2].credentials = { httpHeaderAuth: { id: 'production' } };
  source.nodes[2].parameters.authentication = 'predefinedCredentialType';
  const node = prepareWorkflow(source, fixture, 'http://127.0.0.1:1234').workflow.nodes[2];
  assert.equal(node.credentials, undefined); assert.equal(node.parameters.authentication, 'none');
});

test('all downstream HTTP nodes require a mock', () => {
  const spec = copy(fixture); spec.mocks = [];
  assert.throws(() => prepareWorkflow(workflow, spec, ''), /needs a mock/);
});

test('credentials on an unmocked integration produce a targeted error', () => {
  const source = copy(workflow); source.nodes[2].type = 'n8n-nodes-base.slack'; source.nodes[2].credentials = { slackApi: { id: 'live' } };
  const spec = copy(fixture); spec.mocks = [];
  assert.throws(() => prepareWorkflow(source, spec, ''), /uses credentials/);
});

for (const expression of ["={{ $('Start').item.json }}", '={{ $node["Start"].json }}', "={{ $items('Start') }}", '={{ $("Start").item.json }}']) {
  test(`outside-slice dependency is surfaced: ${expression}`, () => {
    const source = copy(workflow); source.nodes[2].parameters.jsonBody = expression;
    assert.throws(() => prepareWorkflow(source, fixture, ''), /references "Start" outside the slice/);
  });
}

test('incoming branch dependency is surfaced', () => {
  const source = copy(workflow); source.connections.Start.main[0].push({ node: 'Render', type: 'main', index: 1 });
  assert.throws(() => prepareWorkflow(source, fixture, ''), /incoming main connection from "Start" to "Render"/);
});

test('fixture boundary inside a loop produces a targeted error', () => {
  const source = copy(workflow); source.connections.Render = { main: [[{ node: 'Fixture', type: 'main', index: 0 }]] };
  assert.throws(() => prepareWorkflow(source, fixture, ''), /inside a loop/);
});

test('mock URL supports n8n path expressions', () => {
  const spec = copy(fixture); spec.mocks[0].url = '/renders/{{ $json.shortId }}';
  assert.equal(prepareWorkflow(workflow, spec, 'http://127.0.0.1:1234').workflow.nodes[2].parameters.url, '=http://127.0.0.1:1234/0/renders/{{ $json.shortId }}');
});

test('routes require meaningful counts and request body cardinality', () => {
  const spec = copy(fixture); spec.mocks[0].routes[0].expect.count = 1;
  assert.throws(() => validateCase(spec), /length must match/);
});

test('mock response sequence repeats the final response and checks exact bodies', async () => {
  const spec = copy(fixture); const route = spec.mocks[0].routes[0];
  route.expect.count = 3; route.expect.bodies.push(route.expect.bodies[1]);
  const mock = await startMock(spec);
  try {
    const values = [];
    for (const body of route.expect.bodies) values.push(await (await fetch(mock.baseUrl + '/0/renders', { method: 'POST', body: JSON.stringify(body) })).json());
    assert.deepEqual(values, [{ id: 'render-42' }, { id: 'render-43' }, { id: 'render-43' }]);
    assert.equal(mock.checks().every(c => c.passed), true);
  } finally { await mock.close(); }
});

test('unexpected routes and request caps fail checks', async () => {
  const spec = copy(fixture); spec.maxRequests = 1;
  const mock = await startMock(spec);
  try {
    assert.equal((await fetch(mock.baseUrl + '/0/unknown')).status, 404);
    assert.equal((await fetch(mock.baseUrl + '/0/unknown')).status, 429);
    assert.equal(mock.checks()[0].passed, false); assert.equal(mock.checks()[1].passed, false);
  } finally { await mock.close(); }
});

test('parser extracts execution JSON from log noise and braces in strings', () => {
  const execution = { data: { resultData: { error: { message: 'bad } " escaped' } } } };
  assert.deepEqual(executionFrom(`log\n{"unrelated":true}\n${JSON.stringify(execution, null, 2)}\ntrailer`), execution);
  assert.equal(executionFrom('log without JSON'), null);
});

test('n8n error fails even when CLI exits zero', () => {
  const execution = { data: { resultData: { error: { message: 'JSON body' } } } };
  assert.equal(executionChecks(execution, { exitCode: 0 }, [])[0].passed, false);
});

test('output checks preserve run order and exact item cardinality', () => {
  const execution = { data: { resultData: { runData: { Render: [{ data: { main: [[{ json: { id: 1 } }]] } }, { data: { main: [[{ json: { id: 2 } }]] } }] } } } };
  assert.equal(executionChecks(execution, { exitCode: 0 }, [{ node: 'Render', equals: [{ id: 1 }, { id: 2 }] }])[1].passed, true);
  assert.equal(executionChecks(execution, { exitCode: 0 }, [{ node: 'Render', equals: [{ id: 1 }] }])[1].passed, false);
});

test('JUnit escapes untrusted strings and separates setup errors', () => {
  const output = junit({ name: 'a"<&', status: 'error', error: 'failed <tag>\u0000', durationMs: 100, checks: [] });
  assert.match(output, /errors="1"/); assert.match(output, /a&quot;&lt;&amp;/); assert.match(output, /&lt;tag&gt;/);
  assert.equal(output.includes('\u0000'), false);
});

test('runtime receives isolated configuration and a fresh encryption key', () => {
  process.env.N8N_CHECK_TEST_SECRET = 'test'; process.env.DB_POSTGRESDB_PASSWORD = 'test';
  const env = runtimeEnv('/fixture/home');
  assert.equal(env.DB_POSTGRESDB_PASSWORD, undefined); assert.equal(env.N8N_CHECK_TEST_SECRET, undefined);
  assert.equal(env.DB_TYPE, 'sqlite'); assert.equal(env.HOME, '/fixture/home');
  assert.notEqual(env.N8N_ENCRYPTION_KEY, runtimeEnv('/fixture/home').N8N_ENCRYPTION_KEY);
  delete process.env.N8N_CHECK_TEST_SECRET; delete process.env.DB_POSTGRESDB_PASSWORD;
});

test('subprocess timeout is surfaced and child group terminated', async () => {
  const result = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, 100);
  assert.match(result.error, /timeout/); assert.equal(result.exitCode, null);
});

test('missing executable is surfaced', async () => {
  const result = await command('/n8n-check-missing-runtime', [], {}, 100);
  assert.match(result.error, /ENOENT/);
});
