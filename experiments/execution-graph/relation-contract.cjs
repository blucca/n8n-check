#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// One explicit customer-recipient contract, over complete local saved records.
// subjectId declares the order being acted on. Schedule/slot intent is supplied
// by the workflow's business oracle, independently from this relationship check.
const fs = require('node:fs');
const { ExecutionGraph, coord, key } = require('./audit-bundle.cjs');
const validIndex = n => Number.isInteger(n) && n >= 0;
function requireEvidence(ok, code) { if (!ok) throw new Error(code); }
function readRecord(json, path) {
  requireEvidence(Array.isArray(path) && path.every(p => typeof p === 'string'), 'INVALID_CONTRACT');
  let value = json;
  for (const part of path) {
    requireEvidence(value && Object.hasOwn(value, part), 'ROLE_RECORD_INVALID');
    value = value[part];
  }
  return value;
}
function roleItems(graph, spec) {
  requireEvidence(spec && typeof spec.node === 'string' && validIndex(spec.run) && validIndex(spec.output), 'INVALID_CONTRACT');
  const base = coord(spec.execution, spec.node, spec.run, spec.output, 0);
  const values = graph.executions.get(base.execution)?.data?.resultData?.runData?.[base.node]?.[base.run]?.data?.main?.[base.output];
  requireEvidence(Array.isArray(values) && values.length > 0, 'ROLE_SOURCE_MISSING');
  return values.map((item, i) => ({ coordinate: { ...base, item: i }, record: readRecord(item.json, spec.record_path) }));
}
function uniqueIndex(rows, fields, code) {
  const table = new Map();
  for (const row of rows) {
    requireEvidence(row.record && fields.every(field => typeof row.record[field] === 'string' && row.record[field].length > 0), 'ROLE_RECORD_INVALID');
    const k = JSON.stringify(fields.map(field => row.record[field]));
    requireEvidence(!table.has(k), code);
    table.set(k, row);
  }
  return table;
}
function auditRelations(executions, contract) {
  try {
    requireEvidence(contract?.version === 1, 'INVALID_CONTRACT');
    const graph = new ExecutionGraph(executions);
    const orders = roleItems(graph, contract.orders);
    const customers = roleItems(graph, contract.customers);
    const byOrderId = uniqueIndex(orders, ['id'], 'DUPLICATE_ORDER_ID');
    uniqueIndex(orders, ['tenantId', 'id'], 'DUPLICATE_ORDER_ID');
    requireEvidence(orders.every(row => typeof row.record.customerId === 'string' && row.record.customerId.length > 0), 'ROLE_RECORD_INVALID');
    const byCustomerKey = uniqueIndex(customers, ['tenantId', 'id'], 'DUPLICATE_CUSTOMER_KEY');
    requireEvidence(customers.every(row => typeof row.record.email === 'string' && row.record.email.length > 0), 'ROLE_RECORD_INVALID');
    const effects = roleItems(graph, { ...contract.effects, record_path: [] });
    const orderCut = new Set(orders.map(row => key(row.coordinate)));
    const customerCut = new Set(customers.map(row => key(row.coordinate)));
    const sourceCut = new Set([...orderCut, ...customerCut]);
    requireEvidence(sourceCut.size === orders.length + customers.length, 'INVALID_CONTRACT');
    const slots = new Set();
    const findings = effects.map(({ coordinate, record }) => {
      requireEvidence(record && validIndex(record.slot) && typeof record.subjectId === 'string' && typeof record.recipient === 'string', 'EFFECT_RECORD_INVALID');
      requireEvidence(!slots.has(record.slot), 'DUPLICATE_EFFECT_SLOT');
      slots.add(record.slot);
      const order = byOrderId.get(JSON.stringify([record.subjectId]));
      requireEvidence(order, 'UNKNOWN_SUBJECT_ID');
      const customer = byCustomerKey.get(JSON.stringify([order.record.tenantId, order.record.customerId]));
      requireEvidence(customer, 'CUSTOMER_NOT_FOUND');
      const roots = graph.trace(coordinate, sourceCut);
      requireEvidence(roots.length > 0 && roots.every(c => sourceCut.has(key(c))), 'PROVENANCE_INCOMPLETE');
      const rootKeys = new Set(roots.map(key));
      const codes = [];
      if (!rootKeys.has(key(order.coordinate))) codes.push('ORDER_ROOT_MISSING');
      if (!rootKeys.has(key(customer.coordinate))) codes.push('CUSTOMER_ROOT_MISSING');
      if (record.recipient !== customer.record.email) codes.push('RECIPIENT_MISMATCH');
      return { effect: coordinate, slot: record.slot, subject: order.coordinate,
        customer: customer.coordinate, roots,
        order_roots: roots.filter(c => orderCut.has(key(c))),
        customer_roots: roots.filter(c => customerCut.has(key(c))),
        status: codes.length ? 'mismatch' : 'consistent', codes };
    });
    const mismatches = findings.filter(row => row.status === 'mismatch').length;
    return { status: mismatches ? 'mismatch' : 'consistent',
      scope: 'Declared subjectId -> unique (order.tenantId, order.customerId) customer -> saved recipient; both roles evidenced in complete ancestry',
      checked_items: findings.length, mismatches, source_counts: { orders: orders.length, customers: customers.length }, findings };
  } catch (error) {
    const fixedCode = /^[A-Z_]+$/.test(error.message);
    return { status: 'incomplete', code: fixedCode ? error.message : 'PROVENANCE_INCOMPLETE',
      ...(fixedCode ? {} : { reason: error.message }) };
  }
}
module.exports = { auditRelations };
if (require.main === module) {
  let report;
  try {
    requireEvidence(process.argv.length >= 5, 'USAGE_CONTRACT_PARENT_CHILD');
    const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    report = auditRelations(process.argv.slice(3).map(load), load(process.argv[2]));
  } catch { report = { status: 'incomplete', code: 'INPUT_READ_FAILED' }; }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = { consistent: 0, mismatch: 1, incomplete: 2 }[report.status];
}
