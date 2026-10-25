// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// Read-only diagnosis of one recorded, waiting, once-mode child call.
// This checks ancestry at the call boundary; business expectations stay separate.
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { findPairedItemThroughWorkflowData: trace } = require('./backtracking.cjs');

function requireEvidence(condition, reason) {
  if (!condition) throw new Error(reason);
}

function pairs(value) {
  requireEvidence(value !== undefined, 'Missing pairedItem provenance');
  const entries = Array.isArray(value) ? value : [value];
  requireEvidence(entries.length > 0, 'Empty pairedItem provenance');
  const unique = new Map();
  for (const entry of entries) {
    const pair = typeof entry === 'number' ? { item: entry } : entry;
    requireEvidence(pair && Number.isInteger(pair.item) && pair.item >= 0,
      'Invalid pairedItem item index');
    const input = pair.input ?? 0;
    requireEvidence(Number.isInteger(input) && input >= 0, 'Invalid pairedItem input index');
    requireEvidence(!pair.sourceOverwrite, 'Boundary sourceOverwrite requires a separate contract');
    unique.set(`${input}:${pair.item}`, { input, item: pair.item });
  }
  return [...unique.values()].sort((a, b) => a.input - b.input || a.item - b.item);
}

function auditBoundary(parent, child) {
  const parentRuns = parent?.data?.resultData?.runData;
  const childData = child?.data;
  const childRuns = childData?.resultData?.runData;
  requireEvidence(parent?.id && child?.id && parentRuns && childRuns,
    'Provide two complete API execution exports with IDs and saved runData');
  requireEvidence(parent.status === 'success' && child.status === 'success',
    'This check covers completed successful parent and child executions');

  const calls = [];
  for (const [node, runs] of Object.entries(parentRuns)) {
    requireEvidence(Array.isArray(runs), 'Invalid parent runData');
    for (const [run, task] of runs.entries()) {
      if (String(task.metadata?.subExecution?.executionId) === String(child.id)) {
        calls.push({ node, run, task });
      }
    }
  }
  requireEvidence(calls.length === 1, 'Expected one parent call edge matching this child execution ID');
  const { node, run, task } = calls[0];
  const definition = parent.workflowData?.nodes?.find(value => value.name === node);
  requireEvidence(definition?.type === 'n8n-nodes-base.executeWorkflow' && definition.typeVersion === 1.2,
    'This recorded-node contract covers Execute Workflow version 1.2');
  requireEvidence((definition.parameters?.mode ?? 'once') === 'once' &&
    definition.parameters?.options?.waitForSubWorkflow !== false,
  'Use a waiting once-mode child call');
  requireEvidence(String(task.metadata.subExecution.workflowId) === String(child.workflowId),
    'Child workflow ID differs from the actual parent call edge');

  const roots = [];
  for (const [name, runs] of Object.entries(childRuns)) {
    requireEvidence(Array.isArray(runs), 'Invalid child runData');
    for (const [index, value] of runs.entries()) {
      requireEvidence(Array.isArray(value.source), 'Missing child source edges');
      if (!value.source.some(source => source?.previousNode)) roots.push({ name, index, task: value });
    }
  }
  requireEvidence(roots.length === 1 && roots[0].index === 0,
    'Expected one recorded child input boundary');
  const root = roots[0];
  const trigger = child.workflowData?.nodes?.find(value => value.name === root.name);
  requireEvidence(trigger?.type === 'n8n-nodes-base.executeWorkflowTrigger' &&
    trigger.parameters?.inputSource === 'passthrough' && root.task.source.length === 0,
  'Expected a passthrough Execute Workflow Trigger with complete provenance');
  const reverseEdge = root.task.metadata?.parentExecution;
  requireEvidence(String(reverseEdge?.executionId) === String(parent.id) &&
    String(reverseEdge?.workflowId) === String(parent.workflowId),
  'Child parentExecution metadata differs from this parent');

  requireEvidence(task.source?.length === 1 && task.source[0]?.previousNode,
    'Expected a single recorded caller input edge');
  const source = task.source[0];
  const sourceRun = source.previousNodeRun ?? 0;
  const sourceOutput = source.previousNodeOutput ?? 0;
  const input = parentRuns[source.previousNode]?.[sourceRun]?.data?.main?.[sourceOutput];
  const start = root.task.data?.main;
  requireEvidence(Array.isArray(input) && start?.length === 1 && Array.isArray(start[0]) &&
    start[0].length === input.length, 'Caller input and child trigger item counts differ');
  for (const [index, item] of start[0].entries()) {
    requireEvidence(isDeepStrictEqual(item.json, input[index].json) &&
      isDeepStrictEqual(pairs(item.pairedItem), [{ input: 0, item: index }]),
    'Child trigger does not preserve the recorded caller input order and JSON');
  }

  const last = childData.resultData.lastNodeExecuted;
  const returned = childRuns[last]?.at(-1)?.data?.main;
  const actual = task.data?.main;
  requireEvidence(Array.isArray(returned) && Array.isArray(actual) && returned.length === actual.length,
    'Child terminal output and caller output shapes differ');
  const findings = [];
  for (const [output, items] of actual.entries()) {
    requireEvidence(Array.isArray(items) && Array.isArray(returned[output]) &&
      items.length === returned[output].length, 'Child terminal output and caller item counts differ');
    for (const [index, item] of items.entries()) {
      const terminal = returned[output][index];
      requireEvidence(isDeepStrictEqual(item.json, terminal.json),
        'Caller output JSON differs from the recorded child terminal item');
      const expected = pairs(trace(childData, terminal, index));
      requireEvidence(expected.every(pair => pair.input === 0 && pair.item < input.length),
        'Child ancestry does not resolve within the recorded caller input');
      const observed = pairs(item.pairedItem);
      findings.push({ output, item: index, expected, observed,
        status: isDeepStrictEqual(expected, observed) ? 'consistent' : 'mismatch' });
    }
  }
  requireEvidence(findings.length > 0, 'This child call returned no items to inspect');
  const mismatches = findings.filter(row => row.status === 'mismatch').length;
  return {
    status: mismatches ? 'mismatch' : 'consistent',
    scope: 'Recorded ancestry at one waiting, once-mode Execute Workflow 1.2 boundary',
    parent_execution: String(parent.id), child_execution: String(child.id), node, run,
    caller_input: { node: source.previousNode, run: sourceRun, output: sourceOutput },
    checked_items: findings.length, mismatches, findings,
  };
}

module.exports = { auditBoundary };

if (require.main === module) {
  let report;
  try {
    requireEvidence(process.argv.length === 4,
      'Usage: node audit-executions.cjs parent-execution.json child-execution.json');
    report = auditBoundary(...process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch (error) {
    report = { status: 'incomplete', reason: error.message };
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = { consistent: 0, mismatch: 1, incomplete: 2 }[report.status];
}
