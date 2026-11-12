// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
// Experimental saved-data adapter. No execution, model calls, or payload copies
// in the report. The native scope and measured cases are listed in README.md.
// Input values are parsed JSON. Object field order is irrelevant, array order
// and signed zero are preserved, matching the saved-data CLI's JSON comparisons.
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

function evidence(ok, reason) { if (!ok) throw new Error(reason); }
function index(value) { return Number.isInteger(value) && value >= 0; }
function id(value) {
  evidence((typeof value === 'string' && value.length > 0) || index(value), 'Missing execution/workflow ID');
  return String(value);
}
function coord(execution, node, run, output, item) {
  evidence(typeof node === 'string' && node.length > 0 && [run, output, item].every(index),
    'Invalid execution coordinate');
  return { execution: id(execution), node, run, output, item };
}
function key(c) { return JSON.stringify([c.execution, c.node, c.run, c.output, c.item]); }
function unique(values) {
  return [...new Map(values.map(c => [key(c), c])).values()].sort((a, b) => key(a).localeCompare(key(b)));
}
function pairs(value) {
  evidence(value !== undefined, 'Missing pairedItem provenance');
  const rows = Array.isArray(value) ? value : [value];
  evidence(rows.length > 0, 'Empty pairedItem provenance');
  return rows.map(row => {
    const p = typeof row === 'number' ? { item: row } : row;
    evidence(p && index(p.item) && index(p.input ?? 0), 'Invalid pairedItem index');
    return p;
  });
}

class ExecutionGraph {
  constructor(executions) {
    this.executions = new Map();
    this.imports = new Map();
    this.returns = new Map();
    this.boundaries = [];
    for (const execution of executions) {
      const executionId = id(execution?.id);
      id(execution?.workflowId);
      evidence(!this.executions.has(executionId), `Duplicate execution ID ${executionId}; use one instance bundle`);
      evidence(execution.dataTooLargeToDisplay !== true,
        `Execution ${executionId}: API data exceeds the display-size limit; request ignoreDataSizeLimit=true`);
      evidence(execution.status === 'success' && execution?.data?.resultData?.runData && execution?.workflowData?.nodes,
        `Execution ${executionId}: provide complete successful API execution JSON`);
      this.executions.set(executionId, execution);
    }
    for (const execution of executions) this.addCalls(execution);
    evidence(this.boundaries.length > 0, 'Bundle has no inspectable child calls');
  }

  at(c) {
    const execution = this.executions.get(c.execution);
    const task = execution?.data?.resultData?.runData?.[c.node]?.[c.run];
    const item = task?.data?.main?.[c.output]?.[c.item];
    evidence(task && item, `Missing saved item ${key(c)}`);
    return { execution, task, item };
  }

  source(c, p) {
    const { task } = this.at(c);
    const source = p.sourceOverwrite ?? task.source?.[p.input ?? 0];
    evidence(source?.previousNode, `Missing consumer inlet at ${key(c)}`);
    const previous = coord(c.execution, source.previousNode,
      source.previousNodeRun ?? 0, source.previousNodeOutput ?? 0, p.item);
    this.at(previous);
    return previous;
  }

  trace(start, stopAt = new Set()) {
    // Native loops point back to recorded earlier runs. A cycle is a broken
    // evidence graph. Memoization is local to this exact stop contract.
    const active = new Set();
    const memo = new Map();
    const visit = c => {
      const k = key(c);
      this.at(c);
      if (stopAt.has(k)) return [c];
      if (memo.has(k)) return memo.get(k);
      evidence(!active.has(k), `Cyclic saved provenance at ${k}`);
      active.add(k);
      try {
        const { task, item } = this.at(c);
        const cross = this.imports.get(k) ?? this.returns.get(k);
        let roots;
        if (cross) roots = visit(cross);
        else {
          evidence(Array.isArray(task.source), `Missing source edges at ${k}`);
          roots = task.source.length === 0
            ? [c]
            : unique(pairs(item.pairedItem).flatMap(p => visit(this.source(c, p))));
        }
        memo.set(k, roots);
        return roots;
      } finally { active.delete(k); }
    };
    return unique(visit(start));
  }

  terminal(child, trigger) {
    const result = child.data.resultData;
    const node = result.lastNodeExecuted;
    const runs = result.runData[node];
    evidence(Array.isArray(runs) && runs.length > 0, `Child ${child.id}: missing terminal runs`);
    evidence(!(child.mode === 'manual' && result.pinData?.[node]), 'Manual terminal pinData needs a separate adapter');
    const lastOnly = trigger.typeVersion < 1.2 && trigger.parameters?.returnOutput !== 'allRuns';
    const selected = lastOnly ? [{ task: runs.at(-1), run: runs.length - 1 }]
      : runs.map((task, run) => ({ task, run })).sort((a, b) =>
        (a.task.executionIndex ?? 0) - (b.task.executionIndex ?? 0));
    const outputs = [];
    for (const { task, run } of selected) {
      evidence(Array.isArray(task.data?.main), `Child ${child.id}: missing terminal output`);
      for (const [output, items] of task.data.main.entries()) {
        outputs[output] ??= [];
        evidence(items === null || Array.isArray(items), 'Invalid terminal branch');
        for (const item of (items ?? []).keys()) outputs[output].push(coord(child.id, node, run, output, item));
      }
    }
    return outputs;
  }

  addCalls(parent) {
    for (const definition of parent.workflowData.nodes) {
      if (definition.type !== 'n8n-nodes-base.executeWorkflow') continue;
      const runs = parent.data.resultData.runData[definition.name] ?? [];
      evidence(Array.isArray(runs), 'Invalid caller runData');
      for (const [run, task] of runs.entries()) {
        evidence([1.2, 1.3].includes(definition.typeVersion) &&
          definition.parameters?.options?.waitForSubWorkflow !== false,
        'Adapter covers waiting Execute Workflow 1.2/1.3');
        const mode = definition.parameters?.mode ?? 'once';
        evidence(['once', 'each'].includes(mode), 'Unsupported caller mode');
        evidence(task.source?.length === 1 && task.source[0]?.previousNode, 'Expected one caller input edge');
        const source = task.source[0];
        const inputTask = parent.data.resultData.runData[source.previousNode]?.[source.previousNodeRun ?? 0];
        const input = inputTask?.data?.main?.[source.previousNodeOutput ?? 0];
        evidence(Array.isArray(input) && Array.isArray(task.data?.main), 'Missing caller input/output data');
        const inputs = input.map((_, item) => coord(parent.id, source.previousNode,
          source.previousNodeRun ?? 0, source.previousNodeOutput ?? 0, item));
        const groups = new Map();
        if (mode === 'once') {
          const edge = task.metadata?.subExecution;
          evidence(edge, 'Missing once-mode subExecution metadata');
          groups.set(id(edge.executionId), { edge, outputs: [] });
        }
        for (const [output, items] of task.data.main.entries()) {
          evidence(items === null || Array.isArray(items), 'Invalid caller branch');
          for (const [item, value] of (items ?? []).entries()) {
            const edge = mode === 'once' ? task.metadata.subExecution : value.metadata?.subExecution;
            evidence(edge, 'Missing each-mode item subExecution metadata');
            const childId = id(edge.executionId);
            if (!groups.has(childId)) groups.set(childId, { edge, outputs: [] });
            const group = groups.get(childId);
            evidence(id(group.edge.workflowId) === id(edge.workflowId), 'Conflicting child workflow IDs');
            group.outputs[output] ??= [];
            group.outputs[output].push(coord(parent.id, definition.name, run, output, item));
          }
        }
        if (mode === 'each') evidence(task.metadata?.subExecutionsCount === groups.size && groups.size === input.length,
          'Each-mode missing child/output evidence; zero-return calls require a separate acquisition contract');
        const importedIndices = [];
        for (const { edge, outputs } of groups.values()) {
          importedIndices.push(...this.addBoundary(parent, definition, run, mode, inputs, edge, outputs));
        }
        if (mode === 'each') evidence(new Set(importedIndices).size === input.length,
          'Each-mode child input indices do not cover each caller input exactly once');
      }
    }
  }

  addBoundary(parent, definition, run, mode, inputs, edge, callerOutputs) {
    const child = this.executions.get(id(edge.executionId));
    evidence(child && id(child.workflowId) === id(edge.workflowId), `Missing or mixed child execution ${edge.executionId}`);
    const starts = [];
    for (const [node, runs] of Object.entries(child.data.resultData.runData)) {
      evidence(Array.isArray(runs), 'Invalid child runData');
      for (const [run, task] of runs.entries()) {
        evidence(Array.isArray(task.source), 'Missing child source edges');
        if (task.source.length === 0) starts.push({ node, run, task });
      }
    }
    evidence(starts.length === 1 && starts[0].run === 0, 'Expected one child input boundary');
    const start = starts[0];
    const trigger = child.workflowData.nodes.find(n => n.name === start.node);
    evidence(trigger?.type === 'n8n-nodes-base.executeWorkflowTrigger' &&
      [1.1, 1.2].includes(trigger.typeVersion) && trigger.parameters?.inputSource === 'passthrough',
    'Adapter covers passthrough Execute Workflow Trigger 1.1/1.2');
    const reverse = start.task.metadata?.parentExecution;
    evidence(id(reverse?.executionId) === id(parent.id) && id(reverse?.workflowId) === id(parent.workflowId),
      'Child parentExecution metadata differs from caller');
    evidence(reverse.shouldResume === true, 'Adapter covers recorded waiting child calls');
    const entered = start.task.data?.main;
    evidence(entered?.length === 1 && Array.isArray(entered[0]) &&
      entered[0].length === (mode === 'once' ? inputs.length : 1), 'Child input shape differs from call mode');
    const importedIndices = [];
    for (const [local, value] of entered[0].entries()) {
      // In passthrough each-mode, native input.index preserves the caller slot
      // independently of the returned pairedItem. Never infer it from output.
      const callerIndex = mode === 'once' ? local : value.index;
      evidence(index(callerIndex) && callerIndex < inputs.length, 'Missing each-mode original caller input index');
      evidence(equal(value.json, this.at(inputs[callerIndex]).item.json), 'Child passthrough JSON differs from caller input');
      evidence(pairs(value.pairedItem).every(p => p.item === local && (p.input ?? 0) === 0 && !p.sourceOverwrite),
        'Unexpected child-local input pairing');
      const imported = coord(child.id, start.node, 0, 0, local);
      evidence(!this.imports.has(key(imported)), 'Child execution is associated with multiple call edges');
      this.imports.set(key(imported), inputs[callerIndex]);
      importedIndices.push(callerIndex);
    }
    const terminals = this.terminal(child, trigger);
    const findings = [];
    for (let output = 0; output < Math.max(terminals.length, callerOutputs.length); output++) {
      const from = terminals[output] ?? [];
      const to = callerOutputs[output] ?? [];
      evidence(from.length === to.length, 'Child terminal and caller return counts differ');
      for (let item = 0; item < from.length; item++) {
        evidence(equal(this.at(from[item]).item.json, this.at(to[item]).item.json),
          'Child terminal JSON differs from caller return');
        this.returns.set(key(to[item]), from[item]);
        findings.push({ caller: to[item], terminal: from[item] });
      }
    }
    evidence(findings.length > 0, 'Child call returned no inspectable items');
    this.boundaries.push({ parent_execution: id(parent.id), child_execution: id(child.id),
      node: definition.name, run, mode, inputs, findings });
    return importedIndices;
  }

  audit() {
    let checked = 0;
    let mismatches = 0;
    // A Webhook array is one transport item but contains several business
    // records. Report roots at the outer inspected call inputs, preserving
    // those entity slots. trace() also accepts an explicit source cut.
    const children = new Set(this.boundaries.map(b => b.child_execution));
    const rootCut = new Set(this.boundaries.filter(b => !children.has(b.parent_execution))
      .flatMap(b => b.inputs.map(key)));
    const boundaries = this.boundaries.map(boundary => {
      const stopAt = new Set(boundary.inputs.map(key));
      const findings = boundary.findings.map(({ caller, terminal }) => {
        const expected = this.trace(terminal, stopAt);
        evidence(expected.length > 0 && expected.every(c => stopAt.has(key(c))),
          'Child ancestry leaves recorded caller input contract');
        const observed = unique(pairs(this.at(caller).item.pairedItem).map(p => this.source(caller, p)));
        const mismatch = !equal(expected, observed);
        checked++;
        mismatches += Number(mismatch);
        return { caller, terminal, expected, observed, roots: this.trace(caller, rootCut),
          status: mismatch ? 'mismatch' : 'consistent' };
      });
      const { inputs, ...summary } = boundary;
      return { ...summary, findings };
    });
    return { status: mismatches ? 'mismatch' : 'consistent',
      scope: 'Composed recorded ancestry in waiting passthrough child calls',
      root_scope: 'Outer inspected caller input coordinates; business roles use an explicit source contract',
      execution_count: this.executions.size, boundary_count: boundaries.length,
      checked_items: checked, mismatches, boundaries };
  }
}

function auditExecutions(executions) {
  try { return new ExecutionGraph(executions).audit(); }
  catch (error) { return { status: 'incomplete', reason: error.message }; }
}

export { auditExecutions, ExecutionGraph, coord, key };
