#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// v1: one independently observed request per saved target output item, with a
// one-to-one source binding to the declared caller output. Receiver/log records
// supply the coordinates and bodies; this checker performs no expression replay.
const fs = require('node:fs');
const { ExecutionGraph, auditExecutions, coord, key } = require('./audit-bundle.cjs');
const { auditRelations } = require('./relation-contract.cjs');
const index = n => Number.isInteger(n) && n >= 0;
function evidence(ok, code) { if (!ok) throw new Error(code); }

function outputCoordinates(graph, spec) {
  evidence(spec && typeof spec.node === 'string' && index(spec.run) && index(spec.output), 'INVALID_EFFECT_CONTRACT');
  const start = coord(spec.execution, spec.node, spec.run, spec.output, 0);
  const items = graph.executions.get(start.execution)?.data?.resultData?.runData?.[start.node]?.[start.run]?.data?.main?.[start.output];
  evidence(Array.isArray(items) && items.length > 0, 'TARGET_OUTPUT_MISSING');
  return items.map((_, item) => ({ ...start, item }));
}

function auditObserved(executions, contract, observations, saved) {
  try {
    evidence(saved.status !== 'incomplete', 'SAVED_RELATION_INCOMPLETE');
    evidence(Array.isArray(observations), 'OBSERVATION_INPUT_INVALID');
    const graph = new ExecutionGraph(executions);
    const targets = outputCoordinates(graph, contract.observed_effects);
    const targetKeys = new Set(targets.map(key));
    const byCoordinate = new Map();
    for (const row of observations) {
      evidence(row?.coordinate && row.body && index(row.body.slot) &&
        typeof row.body.subjectId === 'string' && row.body.subjectId.length > 0 &&
        typeof row.body.recipient === 'string' && row.body.recipient.length > 0, 'OBSERVATION_RECORD_INVALID');
      const c = row.coordinate;
      const address = coord(c.execution, c.node, c.run, c.output, c.item);
      const k = key(address);
      evidence(targetKeys.has(k), 'OBSERVATION_OUTSIDE_TARGET');
      graph.at(address);
      evidence(!byCoordinate.has(k), 'DUPLICATE_OBSERVATION_COORDINATE');
      byCoordinate.set(k, row.body);
    }
    evidence(byCoordinate.size === targets.length, 'OBSERVATION_MISSING');

    const byCaller = new Map(saved.findings.map(row => [key(row.effect), row]));
    const callerCut = new Set(byCaller.keys());
    const boundCallers = new Set();
    const findings = targets.map(observed => {
      const callers = graph.trace(observed, callerCut);
      evidence(callers.length === 1 && callerCut.has(key(callers[0])), 'CALLER_EFFECT_BINDING_INCOMPLETE');
      const callerKey = key(callers[0]);
      evidence(!boundCallers.has(callerKey), 'DUPLICATE_CALLER_EFFECT_BINDING');
      boundCallers.add(callerKey);
      const source = byCaller.get(callerKey);
      const declared = graph.at(source.effect).item.json;
      let customer = graph.at(source.customer).item.json;
      for (const part of contract.customers.record_path) customer = customer[part];
      const body = byCoordinate.get(key(observed));
      const codes = source.codes.filter(code => code.endsWith('_ROOT_MISSING'));
      if (body.slot !== declared.slot) codes.push('OBSERVED_SLOT_MISMATCH');
      if (body.subjectId !== declared.subjectId) codes.push('OBSERVED_SUBJECT_MISMATCH');
      if (body.recipient !== customer.email) codes.push('OBSERVED_RECIPIENT_MISMATCH');
      return { observed, caller_effect: source.effect, slot: declared.slot,
        subject: source.subject, customer: source.customer, roots: source.roots,
        order_roots: source.order_roots, customer_roots: source.customer_roots,
        status: codes.length ? 'mismatch' : 'consistent', codes };
    });
    evidence(boundCallers.size === byCaller.size, 'CALLER_EFFECT_COVERAGE_INCOMPLETE');
    const mismatches = findings.filter(row => row.status === 'mismatch').length;
    return { status: mismatches ? 'mismatch' : 'consistent', checked_items: findings.length, mismatches,
      scope: 'Independent observer body at a complete unique target coordinate -> declared caller effect -> evidenced full-key customer',
      findings };
  } catch (error) {
    return { status: 'incomplete', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'EFFECT_EVIDENCE_INCOMPLETE' };
  }
}

function auditEffects(executions, contract, observations) {
  const source_ancestry = auditExecutions(executions);
  const saved_relationship = auditRelations(executions, contract);
  const actual_effects = auditObserved(executions, contract, observations, saved_relationship);
  const statuses = [source_ancestry, saved_relationship, actual_effects].map(row => row.status);
  const status = statuses.includes('incomplete') ? 'incomplete' : statuses.includes('mismatch') ? 'mismatch' : 'consistent';
  return { status, source_ancestry, saved_relationship, actual_effects };
}

module.exports = { auditEffects };
if (require.main === module) {
  let report;
  try {
    evidence(process.argv.length >= 6, 'USAGE_CONTRACT_OBSERVATIONS_PARENT_CHILD');
    const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    report = auditEffects(process.argv.slice(4).map(load), load(process.argv[2]), load(process.argv[3]));
  } catch { report = { status: 'incomplete', code: 'INPUT_READ_FAILED' }; }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = { consistent: 0, mismatch: 1, incomplete: 2 }[report.status];
}
