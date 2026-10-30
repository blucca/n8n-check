// SPDX-License-Identifier: MIT
// Small checks against existing saved fixtures; starts no native n8n process.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuditIssue } = require('./src/index.js');

const roles = ['original-parent', 'original-child', 'repaired-parent', 'repaired-child'];
const fixtures = Object.fromEntries(roles.map(role => [role,
  fs.readFileSync(path.join(__dirname, '../experiments/lineage-boundary/recorded', `${role}.json`), 'utf8'),
]));
const principal = 'synthetic-current-user';
const context = { principal: { accountId: principal }, installContext: 'ari:cloud:jira::site/synthetic-test' };
const input = { issueKey: 'N8N-1', accountId: 'ignored-payload-identity' };

function fakeJira() {
  const state = {
    files: roles.map((role, index) => ({ role, id: String(11001 + index), content: fixtures[role] })),
    comments: [], calls: [], created: 0, readStatus: 200, writeStatus: 201,
  };
  const response = (status, body) => ({
    status, headers: { get: () => null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  });
  const requestJira = async (route, options = {}) => {
    const url = new URL(route, 'https://synthetic.atlassian.net');
    const method = options.method || 'GET';
    state.calls.push({ method, path: url.pathname });
    assert.equal(options.redirect, 'manual');
    if (method === 'GET' && state.readStatus !== 200) return response(state.readStatus, {});
    if (/^\/rest\/api\/3\/attachment\/content\/\d+$/.test(url.pathname)) {
      assert.equal(url.searchParams.get('redirect'), 'false');
      assert.equal(options.headers.Accept, '*/*');
      const file = state.files.find(item => item.id === url.pathname.split('/').at(-1));
      return file ? response(200, file.content) : response(404, {});
    }
    if (url.pathname === '/rest/api/3/issue/10001/comment') {
      if (method === 'GET') {
        const startAt = Number(url.searchParams.get('startAt'));
        return response(200, { startAt, maxResults: 100, total: state.comments.length, comments: state.comments.slice(startAt, startAt + 100) });
      }
      assert.equal(method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.ok(Buffer.byteLength(options.body) <= 16 * 1024);
      if (state.writeStatus !== 201) return response(state.writeStatus, {});
      const comment = { ...JSON.parse(options.body), id: String(22001 + state.created), author: { accountId: principal } };
      state.created++;
      state.comments.push(comment);
      return response(201, comment);
    }
    assert.ok(['/rest/api/3/issue/N8N-1', '/rest/api/3/issue/10001'].includes(url.pathname));
    return response(200, {
      id: '10001', key: 'N8N-1', fields: {
        attachment: state.files.map(file => ({ id: file.id, filename: `${file.role}.json`, size: Buffer.byteLength(file.content), mimeType: 'application/json' })),
      },
    });
  };
  const forge = {
    default: {
      asUser: accountId => { assert.equal(accountId, principal); return { requestJira }; },
      asApp: () => { throw new Error('App-user calls are outside this adapter contract'); },
    },
    route: (strings, ...values) => strings.reduce((route, part, index) => route + part + (index < values.length ? encodeURIComponent(values[index]) : ''), ''),
  };
  return { state, audit: createAuditIssue(forge) };
}

function resolvePointer(value, pointer) {
  return pointer.split('/').slice(1).reduce((item, key) => item?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], value);
}

async function check() {
  const good = fakeJira();
  const first = await good.audit(input, context);
  assert.equal(first.status, 'audited');
  assert.equal(first.before.mismatches, 2);
  assert.deepEqual(first.before.findings.map(row => row.expected), [[{ input: 0, item: 3 }], [{ input: 0, item: 2 }]]);
  assert.deepEqual(first.before.findings.map(row => row.observed), [[{ input: 0, item: 0 }], [{ input: 0, item: 1 }]]);
  assert.equal(first.after.status, 'consistent');
  assert.equal(first.writebackStatus, 'created');
  assert.equal(first.writebackAuthorMatched, true);
  assert.equal(good.state.created, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 64 * 1024);
  assert.deepEqual(first.attachments.map(file => file.executionId), ['3', '4', '3', '4']);
  assert.notEqual(first.attachments[1].workflowId, first.attachments[3].workflowId);
  for (const report of [first.before, first.after]) {
    for (const finding of report.findings) {
      for (const raw of [finding.raw.parentPairing, finding.raw.childTerminalPairing, ...finding.raw.callerInputs]) {
        const file = good.state.files.find(item => item.id === raw.attachmentId);
        assert.notEqual(resolvePointer(JSON.parse(file.content), raw.path), undefined);
      }
    }
  }

  const rerun = await good.audit(input, context);
  assert.equal(rerun.writebackStatus, 'reused');
  assert.equal(rerun.commentId, first.commentId);
  assert.equal(good.state.created, 1);
  good.state.files[3].id = '12004';
  const changed = await good.audit(input, context);
  assert.equal(changed.writebackStatus, 'created');
  assert.notEqual(changed.caseMarker, first.caseMarker);
  assert.notEqual(changed.commentId, first.commentId);
  assert.equal(good.state.created, 2);

  const mixed = fakeJira();
  mixed.state.files[1].content = fixtures['repaired-child'];
  const mixedResult = await mixed.audit(input, context);
  assert.equal(mixedResult.status, 'incomplete');
  assert.match(mixedResult.before.reason, /workflow ID differs/);
  assert.equal(mixed.state.created, 0);

  const missing = fakeJira();
  missing.state.files.splice(1, 1);
  const missingResult = await missing.audit(input, context);
  assert.equal(missingResult.status, 'incomplete');
  assert.match(missingResult.reason, /original-child\.json/);
  assert.equal(missing.state.created, 0);

  const incomplete = fakeJira();
  const child = JSON.parse(incomplete.state.files[1].content);
  delete child.data.resultData.runData;
  incomplete.state.files[1].content = JSON.stringify(child);
  assert.equal((await incomplete.audit(input, context)).status, 'incomplete');
  assert.equal(incomplete.state.created, 0);

  const unauthenticated = fakeJira();
  const authResult = await unauthenticated.audit({ ...input, context: { principal: { accountId: principal } } }, {});
  assert.equal(authResult.status, 'auth-required');
  assert.equal(unauthenticated.state.calls.length, 0);

  const forbiddenRead = fakeJira();
  forbiddenRead.state.readStatus = 403;
  assert.equal((await forbiddenRead.audit(input, context)).status, 'forbidden');
  assert.equal(forbiddenRead.state.calls.some(call => call.method === 'POST'), false);

  const forbiddenWrite = fakeJira();
  forbiddenWrite.state.writeStatus = 403;
  const writeResult = await forbiddenWrite.audit(input, context);
  assert.equal(writeResult.status, 'forbidden');
  assert.equal(writeResult.writebackStatus, 'forbidden');
  assert.equal(writeResult.before.mismatches, 2);
  assert.equal(forbiddenWrite.state.created, 0);
  assert.equal(forbiddenWrite.state.calls.filter(call => call.method === 'POST').length, 1);

  console.log('Forge adapter: saved before/after, raw pointers, serial rerun, changed attachment, mixed/missing evidence and current-user permission checks passed.');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
