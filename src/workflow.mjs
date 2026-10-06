const randomUUID = () => globalThis.crypto.randomUUID();

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
export function validateCase(spec) {
  ensure(plain(spec) && spec.version === 1, 'Case version must be 1');
  ensure(typeof spec.name === 'string' && spec.name.length, 'Case name is required');
  ensure(plain(spec.input) && typeof spec.input.node === 'string', 'input.node is required');
  ensure(Array.isArray(spec.input.items) && spec.input.items.every(plain), 'input.items must be an array of JSON objects');
  ensure(Array.isArray(spec.mocks), 'mocks must be an array (use [] for local-only workflows)');
  const names = new Set();
  for (const mock of spec.mocks) {
    ensure(typeof mock.node === 'string' && !names.has(mock.node), 'Each mock must name a unique HTTP Request node');
    names.add(mock.node);
    ensure(typeof mock.url === 'string' && mock.url.startsWith('/') && !mock.url.startsWith('//'), `Mock ${mock.node}: url must be a local path, optionally with n8n {{ expressions }}`);
    ensure(Array.isArray(mock.routes) && mock.routes.length, `Mock ${mock.node}: routes are required`);
    const routes = new Set();
    for (const route of mock.routes) {
      ensure(typeof route.method === 'string' && /^[A-Z]+$/.test(route.method), 'Route method must be uppercase');
      ensure(typeof route.path === 'string' && route.path.startsWith('/'), 'Route path must start with /');
      const key = `${route.method} ${route.path}`;
      ensure(!routes.has(key), `Duplicate route: ${key}`); routes.add(key);
      ensure(Array.isArray(route.responses) && route.responses.length, `Route ${key}: responses are required`);
      for (const response of route.responses) {
        ensure(plain(response) && Number.isInteger(response.status) && response.status >= 200 && response.status <= 599, `Route ${key}: response status must be 200–599`);
        ensure(Object.hasOwn(response, 'json'), `Route ${key}: response.json is required`);
        ensure(response.headers === undefined || (plain(response.headers) && Object.values(response.headers).every(v => typeof v === 'string')), `Route ${key}: headers must contain strings`);
      }
      ensure(plain(route.expect) && Number.isInteger(route.expect.count) && route.expect.count >= 0, `Route ${key}: expect.count must be a non-negative integer`);
      ensure(route.expect.bodies === undefined || (Array.isArray(route.expect.bodies) && route.expect.bodies.length === route.expect.count), `Route ${key}: expect.bodies length must match expect.count`);
    }
  }
  ensure(Array.isArray(spec.assertions) && spec.assertions.length, 'At least one output assertion is required');
  for (const assertion of spec.assertions) {
    ensure(typeof assertion.node === 'string' && Array.isArray(assertion.equals), 'Each assertion needs node and equals (array of JSON outputs)');
    ensure(assertion.output === undefined || (Number.isInteger(assertion.output) && assertion.output >= 0), 'assertion.output must be a non-negative integer');
  }
  ensure(spec.timeoutMs === undefined || (Number.isInteger(spec.timeoutMs) && spec.timeoutMs >= 1000 && spec.timeoutMs <= 600000), 'timeoutMs must be 1000–600000');
  ensure(spec.maxRequests === undefined || (Number.isInteger(spec.maxRequests) && spec.maxRequests > 0 && spec.maxRequests <= 10000), 'maxRequests must be 1–10000');
  return spec;
}

const edges = connections => Object.entries(connections ?? {}).flatMap(([from, types]) =>
  Object.entries(types).flatMap(([type, branches]) => branches.flatMap(branch => branch.map(edge => ({ from, type, ...edge })))));

export function prepareWorkflow(source, spec, mockBase) {
  validateCase(spec);
  if (Array.isArray(source)) {
    ensure(source.length === 1, 'Supply one workflow export; received an array with multiple workflows');
    source = source[0];
  }
  ensure(plain(source) && Array.isArray(source.nodes) && plain(source.connections), 'Expected an n8n workflow export with nodes and connections');
  const workflow = structuredClone(source);
  const byName = new Map(workflow.nodes.map(node => [node.name, node]));
  ensure(byName.size === workflow.nodes.length, 'Workflow node names must be unique');
  ensure(byName.has(spec.input.node), `Input node not found: ${spec.input.node}`);
  const links = edges(workflow.connections);
  const kept = new Set([spec.input.node]);
  for (const name of kept) for (const edge of links) if (edge.from === name) {
    ensure(byName.has(edge.node), `Connection from ${name} references missing node: ${edge.node}`);
    kept.add(edge.node);
  }
  for (const edge of links) {
    if (kept.has(edge.node) && edge.node !== spec.input.node && !kept.has(edge.from)) {
      throw new Error(`Slice needs incoming ${edge.type} connection from "${edge.from}" to "${edge.node}". Move input.node earlier or provide a self-contained workflow slice.`);
    }
  }
  const changes = [{ node: spec.input.node, change: 'replace with fixture JSON items' }];
  const fixture = byName.get(spec.input.node);
  const fixtureNode = {
    id: fixture.id || randomUUID(), name: fixture.name, position: fixture.position || [0, 0],
    type: 'n8n-nodes-base.code', typeVersion: 2,
    parameters: { mode: 'runOnceForAllItems', jsCode: `return JSON.parse(${JSON.stringify(JSON.stringify(spec.input.items))}).map(json => ({json}));` },
  };
  workflow.nodes = workflow.nodes.filter(node => kept.has(node.name)).map(node => node.name === fixture.name ? fixtureNode : node);
  workflow.connections = Object.fromEntries(Object.entries(workflow.connections).filter(([name]) => kept.has(name)));
  for (const edge of links) ensure(!(kept.has(edge.from) && edge.node === fixture.name), `Input node "${fixture.name}" lies inside a loop. Choose a fixture boundary before the loop.`);
  let triggerName = 'n8n-check start';
  while (byName.has(triggerName)) triggerName += '_';
  workflow.nodes.unshift({ id: randomUUID(), name: triggerName, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-400, 0], parameters: {} });
  workflow.connections[triggerName] = { main: [[{ node: fixture.name, type: 'main', index: 0 }]] };
  const mockNames = new Set(spec.mocks.map(mock => mock.node));
  for (let index = 0; index < spec.mocks.length; index++) {
    const mock = spec.mocks[index];
    const node = workflow.nodes.find(n => n.name === mock.node);
    ensure(node?.type === 'n8n-nodes-base.httpRequest', `Mock node must be an HTTP Request node inside the slice: ${mock.node}`);
    delete node.credentials;
    node.parameters.authentication = 'none';
    delete node.parameters.genericAuthType;
    delete node.parameters.nodeCredentialType;
    node.parameters.url = `${mock.url.includes('{{') ? '=' : ''}${mockBase}/${index}${mock.url}`;
    changes.push({ node: node.name, change: 'route URL to local mock; remove credential references; authentication=none' });
  }
  for (const node of workflow.nodes) {
    ensure(!node.credentials || !Object.keys(node.credentials).length, `Node "${node.name}" uses credentials. Replace this boundary with fixture input or an HTTP mock.`);
    ensure(node.type !== 'n8n-nodes-base.httpRequest' || mockNames.has(node.name), `HTTP Request node "${node.name}" needs a mock entry`);
    for (const match of JSON.stringify(node.parameters).matchAll(/(?:\$\(|\$items\(|\$node\[)\s*(?:\\?")([^"\\]+)(?:\\?")|(?:\$\(|\$items\(|\$node\[)\s*'([^']+)'/g)) {
      const dependency = match[1] ?? match[2];
      ensure(kept.has(dependency), `Node "${node.name}" references "${dependency}" outside the slice. Move input.node earlier or provide a self-contained workflow slice.`);
    }
  }
  for (const assertion of spec.assertions) ensure(kept.has(assertion.node), `Assertion node outside the slice: ${assertion.node}`);
  // Build a fresh workflow record: ownership, pinData, staticData and production settings stay in the source.
  return {
    workflow: {
      id: randomUUID().replaceAll('-', '').slice(0, 16), name: `n8n-check: ${spec.name}`, active: false,
      nodes: workflow.nodes, connections: workflow.connections,
      settings: { ...(source.settings?.timezone ? { timezone: source.settings.timezone } : {}), executionOrder: source.settings?.executionOrder || 'v1', executionTimeout: Math.ceil((spec.timeoutMs ?? 60000) / 1000), saveExecutionProgress: true },
    },
    changes, omittedNodes: source.nodes.filter(node => !kept.has(node.name)).map(node => node.name),
  };
}
