import { prepareWorkflow, validateCase } from './workflow.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => structuredClone(value);
const has = (value, key) => Object.hasOwn(value, key);

function workflowFrom(source) {
  if (Array.isArray(source)) {
    if (source.length !== 1) throw new Error('Supply one workflow export; received an array with multiple workflows');
    source = source[0];
  }
  if (!plain(source) || !Array.isArray(source.nodes) || !plain(source.connections)) throw new Error('Expected an n8n workflow export with nodes and connections');
  if (source.nodes.some(node => !plain(node) || typeof node.name !== 'string' || typeof node.type !== 'string')) throw new Error('Each workflow node needs a name and type');
  if (new Set(source.nodes.map(node => node.name)).size !== source.nodes.length) throw new Error('Workflow node names must be unique');
  return source;
}

function linksFrom(source) {
  const links = [];
  for (const [from, types] of Object.entries(source.connections)) {
    if (!plain(types)) throw new Error(`Invalid connections for node: ${from}`);
    for (const branches of Object.values(types)) {
      if (!Array.isArray(branches) || branches.some(branch => !Array.isArray(branch) || branch.some(edge => !plain(edge) || typeof edge.node !== 'string'))) throw new Error(`Invalid connections for node: ${from}`);
      for (const branch of branches) for (const edge of branch) links.push({ from, to: edge.node });
    }
  }
  return links;
}

function reachable(input, links) {
  const kept = new Set(input ? [input] : []);
  for (const name of kept) for (const link of links) if (link.from === name) kept.add(link.to);
  return kept;
}

function targetFor(source, input, links) {
  const kept = reachable(input, links);
  const candidates = source.nodes.filter(node => kept.has(node.name) && node.name !== input && node.type !== 'n8n-nodes-base.stickyNote');
  const terminal = candidates.filter(node => !links.some(link => link.from === node.name));
  return (terminal.find(node => has(source.pinData ?? {}, node.name)) ?? terminal.at(-1) ?? candidates.at(-1))?.name ?? '';
}

export function inspectWorkflow(raw) {
  const source = workflowFrom(raw);
  const links = linksFrom(source);
  const nodes = source.nodes.map(node => ({ name: node.name, type: node.type, hasPinData: has(source.pinData ?? {}, node.name), pinItemCount: Array.isArray(source.pinData?.[node.name]) ? source.pinData[node.name].length : 0 }));
  const candidates = nodes.filter(node => node.type !== 'n8n-nodes-base.stickyNote' && links.some(link => link.from === node.name));
  const suggestedInputNode = (candidates.find(node => node.hasPinData && node.pinItemCount > 0) ?? candidates[0] ?? nodes.find(node => node.type !== 'n8n-nodes-base.stickyNote'))?.name ?? '';
  return { nodes, suggestedInputNode, suggestedAssertNode: targetFor(source, suggestedInputNode, links) };
}

/** Pure local planning: exported pins supply JSON snapshots; HTTP contracts are supplied by the author. */
export function draftCase(raw, options = {}) {
  const source = workflowFrom(raw);
  const inspected = inspectWorkflow(source);
  const links = linksFrom(source);
  const inputNode = options.inputNode ?? inspected.suggestedInputNode;
  const assertNode = options.assertNode ?? targetFor(source, inputNode, links);
  const output = options.output ?? 0;
  const kept = reachable(inputNode, links);
  const selected = source.nodes.filter(node => kept.has(node.name));
  const http = selected.filter(node => node.name !== inputNode && node.type === 'n8n-nodes-base.httpRequest');
  const issues = [];
  const issue = (code, path, message) => issues.push({ code, path, message });
  const itemsFor = (optionKey, nodeName, path, allowPins = true) => {
    if (has(options, optionKey) && options[optionKey] !== undefined) {
      const value = options[optionKey];
      if (!Array.isArray(value) || !value.every(plain)) issue('items_required', path, 'Supply an array of JSON objects.');
      else if (optionKey === 'inputItems' && value.length === 0) issue('input_empty', path, 'Add at least one input item to exercise the downstream slice.');
      return copy(value);
    }
    const pins = source.pinData?.[nodeName];
    if (allowPins && Array.isArray(pins) && pins.every(item => plain(item) && plain(item.json) && !has(item, 'binary'))) {
      if (optionKey === 'inputItems' && pins.length === 0) issue('input_empty', path, 'The pinned input is empty. Add at least one input item to exercise the downstream slice.');
      return copy(pins.map(item => item.json));
    }
    const detail = pins !== undefined && allowPins ? ' Use JSON-only pins in [{"json": {...}}] form, or enter the JSON item array.' : ' Pin this node after a known-good run and re-export, or enter the JSON item array.';
    issue('items_required', path, `Supply ${optionKey === 'inputItems' ? 'fixture input' : 'expected output'} for "${nodeName || 'select a node'}".${detail}`);
    return null;
  };
  const inputItems = itemsFor('inputItems', inputNode, 'input.items');
  const expectedItems = itemsFor('expectedItems', assertNode, 'assertions[0].equals', output === 0);
  if (inputNode === assertNode && inputNode) issue('assert_downstream', 'assertions[0].node', 'Choose a downstream assertion node to check executed behavior. The input node is replaced with your fixture.');
  if (!assertNode) issue('assert_required', 'assertions[0].node', 'Choose a downstream node whose output this case should preserve.');

  let mocks;
  if (options.mocks !== undefined) {
    mocks = copy(options.mocks);
    if (Array.isArray(mocks)) for (const [index, mock] of mocks.entries()) {
      if (mock?.url === '/TODO') issue('mock_path_required', `mocks[${index}].url`, `\"${mock.node}\": replace /TODO with the local URL path or expression for this HTTP node.`);
      if (Array.isArray(mock?.routes)) for (const [routeIndex, route] of mock.routes.entries()) {
        if (route?.path === '/TODO') issue('mock_path_required', `mocks[${index}].routes[${routeIndex}].path`, `\"${mock.node}\": replace /TODO with a concrete route path for your fixture IDs.`);
      }
    }
  }
  else mocks = http.map((node, index) => {
    const original = node.parameters?.url;
    let path = '/TODO';
    if (typeof original === 'string' && !original.includes('{{') && !original.startsWith('=')) {
      try { const url = new URL(original); if (['http:', 'https:'].includes(url.protocol)) path = url.pathname + url.search; } catch {}
    }
    const method = node.parameters?.method ?? 'GET';
    issue('mock_contract_required', `mocks[${index}]`, `"${node.name}": enter response status/body and expected request count for each route. Pinned output is a snapshot; HTTP status, request count and response grouping are author-supplied contracts.`);
    if (path === '/TODO') issue('mock_path_required', `mocks[${index}].url`, `"${node.name}": set the local URL expression and concrete route paths for your fixture IDs.`);
    return { node: node.name, url: path, routes: [{ method, path, responses: [{ status: null, json: null }], expect: { count: null } }] };
  });
  const spec = { version: 1, name: options.name ?? `${source.name || 'Workflow'} regression`, input: { node: inputNode, items: inputItems }, mocks, assertions: [{ node: assertNode, ...(output ? { output } : {}), equals: expectedItems }] };
  // Valid placeholders exist only in this structural probe; the saved draft retains pending fields.
  const probe = {
    version: 1, name: 'Draft structure check', input: { node: inputNode, items: [] },
    mocks: http.map(node => ({ node: node.name, url: '/draft', routes: [{ method: 'GET', path: '/draft', responses: [{ status: 200, json: {} }], expect: { count: 0 } }] })),
    assertions: [{ node: assertNode, equals: [] }],
  };
  try { prepareWorkflow(source, probe, 'http://127.0.0.1:1'); }
  catch (error) { issue('slice_structure', 'workflow', error.message); }
  if (issues.length === 0) {
    try { validateCase(spec); prepareWorkflow(source, spec, 'http://127.0.0.1:1'); }
    catch (error) { issue('case_invalid', 'case', error.message); }
  } else if (options.mocks !== undefined) {
    try { validateCase({ ...spec, input: { node: inputNode, items: [] }, assertions: [{ node: assertNode, equals: [] }] }); }
    catch (error) { issue('case_invalid', 'case', error.message); }
  }
  return { spec, issues, ready: issues.length === 0, summary: { inputNode, assertNode, keptNodes: selected.map(node => node.name), omittedNodes: source.nodes.filter(node => !kept.has(node.name)).map(node => node.name), httpNodes: http.map(node => node.name) } };
}
