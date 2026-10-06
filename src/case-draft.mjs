import { prepareWorkflow, validateCase, executionSlice } from './workflow.mjs';

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

function reachable(input, links, stopAfter) {
  const kept = new Set(input ? [input] : []);
  for (const name of kept) if (name !== stopAfter) for (const link of links) if (link.from === name) kept.add(link.to);
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
  const assertNode = options.assertNode ?? options.stopAfter ?? targetFor(source, inputNode, links);
  const output = options.output ?? 0;
  let kept;
  try { ({ kept } = executionSlice(source, inputNode, options.stopAfter)); }
  catch { kept = reachable(inputNode, links, options.stopAfter); } // The structural probe below reports the error alongside pending fields.
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
  const assertionMode = options.assertionMode ?? 'exact';
  const assertion = { node: assertNode, ...(output ? { output } : {}) };
  if (assertionMode === 'exact') {
    assertion.equals = itemsFor('expectedItems', assertNode, 'assertions[0].equals', output === 0);
  } else if (['pluck', 'count'].includes(assertionMode)) {
    const pins = source.pinData?.[assertNode];
    const usablePins = output === 0 && Array.isArray(pins) && pins.every(item => plain(item) && plain(item.json) && !has(item, 'binary'));
    assertion.count = options.expectedCount !== undefined ? copy(options.expectedCount) : usablePins ? pins.length : null;
    if (!Number.isInteger(assertion.count) || assertion.count < 0) issue('count_required', 'assertions[0].count', 'Enter the expected item count as a whole number starting at 0.');
    if (assertionMode === 'pluck') {
      assertion.pluck = options.pluck === undefined ? 'json.id' : options.pluck;
      const validPath = typeof assertion.pluck === 'string' && assertion.pluck.split('.').every(part => part.length > 0);
      if (!validPath) issue('pluck_required', 'assertions[0].pluck', 'Enter a dot-separated path from the n8n item, such as json.id.');
      assertion.equals = options.expectedValues !== undefined ? copy(options.expectedValues) : null;
      if (options.expectedValues === undefined && usablePins && validPath) {
        const missingItems = [];
        const values = pins.map((item, index) => {
          let value = item;
          for (const key of assertion.pluck.split('.')) {
            if (value === null || typeof value !== 'object' || !has(value, key)) {
              missingItems.push(index);
              return undefined;
            }
            value = value[key];
          }
          return copy(value);
        });
        if (missingItems.length) issue('projection_missing', 'assertions[0].equals', `The selected field is missing in pinned items at zero-based indexes ${missingItems.join(', ')}. Choose a present field or enter expected values.`);
        else assertion.equals = values;
      }
      if (!Array.isArray(assertion.equals)) issue('values_required', 'assertions[0].equals', 'Enter an array of expected field values in run order, such as ["row-A", "row-B"].');
      else if (Number.isInteger(assertion.count) && assertion.count >= 0 && assertion.count !== assertion.equals.length) issue('count_mismatch', 'assertions[0].count', 'Match the item count to the number of expected field values.');
    }
  } else {
    issue('assertion_mode', 'assertions[0]', 'Choose exact, pluck, or count assertion mode.');
    assertion.equals = null;
  }
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
  const boundary = options.stopAfter === undefined ? {} : { stopAfter: options.stopAfter };
  const spec = { version: 1, name: options.name ?? `${source.name || 'Workflow'} check`, input: { node: inputNode, items: inputItems }, ...boundary, mocks, assertions: [assertion] };
  // Valid placeholders exist only in this structural probe; the saved draft retains pending fields.
  const probe = {
    version: 1, name: 'Draft structure check', input: { node: inputNode, items: [] }, ...boundary,
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
  return { spec, issues, ready: issues.length === 0, summary: { inputNode, assertNode, ...(options.stopAfter === undefined ? {} : { stopAfter: options.stopAfter }), keptNodes: selected.map(node => node.name), omittedNodes: source.nodes.filter(node => !kept.has(node.name)).map(node => node.name), httpNodes: http.map(node => node.name) } };
}
