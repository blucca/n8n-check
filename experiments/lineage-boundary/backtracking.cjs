// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// Follow the consumer's input edge, then the producer's output and run.
// The external boundary is the child trigger's original input item index.
// Missing/unsupported provenance keeps the original helper's undefined contract.
function findPairedItemThroughWorkflowData(workflowRunData, item, itemIndex) {
  const data = workflowRunData?.resultData;
  const runs = data?.runData;
  const last = data?.lastNodeExecuted;
  const runIndex = runs?.[last]?.length - 1;
  if (!Number.isInteger(runIndex) || runIndex < 0) return undefined;
  const active = new Set();

  function visit(node, run, output, index, current) {
    const key = JSON.stringify([node, run, output, index]);
    if (active.has(key)) return undefined;
    const task = runs[node]?.[run];
    if (!task || current?.pairedItem === undefined) return undefined;
    const entries = Array.isArray(current.pairedItem) ? current.pairedItem : [current.pairedItem];
    if (!entries.length) return undefined;
    const roots = new Map();
    active.add(key);
    try {
      for (const entry of entries) {
        const pair = typeof entry === 'number' ? { item: entry } : entry;
        if (!pair || !Number.isInteger(pair.item) || pair.item < 0) return undefined;
        const inlet = pair.input ?? 0;
        if (!Number.isInteger(inlet) || inlet < 0) return undefined;
        if (!task.source?.length && !pair.sourceOverwrite) {
          roots.set(pair.item, { item: pair.item });
          continue;
        }
        const source = pair.sourceOverwrite ?? task.source?.[inlet];
        if (!source?.previousNode) return undefined;
        const previousRun = source.previousNodeRun ?? 0;
        const previousOutput = source.previousNodeOutput ?? 0;
        if (![previousRun, previousOutput].every(value => Number.isInteger(value) && value >= 0)) {
          return undefined;
        }
        const previous = runs[source.previousNode]?.[previousRun]?.data?.main?.[previousOutput]?.[pair.item];
        if (!previous) return undefined;
        const found = visit(source.previousNode, previousRun, previousOutput, pair.item, previous);
        if (!found) return undefined;
        for (const root of found) roots.set(root.item, root);
      }
      return [...roots.values()];
    } finally {
      active.delete(key);
    }
  }

  const roots = visit(last, runIndex, -1, itemIndex, item);
  return roots?.length === 1 ? roots[0] : roots;
}

module.exports = { findPairedItemThroughWorkflowData };
