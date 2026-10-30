// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

const { auditBoundary } = require('../../experiments/lineage-boundary/audit-executions.cjs');

const AUDIT_VERSION = 'n8n-boundary-1';
const FILES = ['original-parent', 'original-child', 'repaired-parent', 'repaired-child'];
const MAX_RAW = 1024 * 1024;
const MAX_FETCHED = 4 * 1024 * 1024;
const MAX_COMMENT = 16 * 1024;
const MAX_RESULT = 64 * 1024;
const MAX_FINDINGS = 20;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const JIRA_ID = /^\d{1,40}$/;
const bytes = value => Buffer.byteLength(value, 'utf8');

function stop(status, reason, nextSteps, writebackStatus) {
  const error = new Error(reason);
  Object.assign(error, { deliveryError: true, status, nextSteps, writebackStatus });
  return error;
}

function exportSteps(role) {
  return [
    `Export the complete ${role} execution using GET /api/v1/executions/<id>?includeData=true.`,
    'Use the child ID from the parent saved metadata.subExecution; retain runData, workflowData and both directions of the call edge.',
    `Attach it to this issue as ${role}.json, then rerun the audit.`,
  ];
}

function selectAttachments(issue) {
  if (!Array.isArray(issue.fields?.attachment)) {
    throw stop('incomplete', 'Jira returned no attachment list.', ['Enable issue attachments and attach the four saved execution JSON files.']);
  }
  const selected = FILES.map(role => {
    const name = `${role}.json`;
    const matches = issue.fields.attachment.filter(item => item.filename === name);
    if (matches.length !== 1) {
      const candidates = matches.map(item => String(item.id)).filter(id => JIRA_ID.test(id));
      throw stop('incomplete', `${name}: expected one attachment; found ${matches.length}.`, matches.length
        ? [`Keep one attachment named ${name}; rename the other candidates (${candidates.join(', ')}), then rerun.`]
        : exportSteps(role));
    }
    const item = matches[0];
    const id = String(item.id);
    if (!JIRA_ID.test(id) || !Number.isSafeInteger(item.size) || item.size <= 0) {
      throw stop('incomplete', `${name} has incomplete attachment ID/size metadata.`, [`Upload a complete ${name} file and rerun.`]);
    }
    return { role, name, id, size: item.size, mimeType: item.mimeType || null };
  });
  if (new Set(selected.map(item => item.id)).size !== FILES.length) {
    throw stop('incomplete', 'The four saved-file roles share an attachment ID.', ['Upload each saved execution as a distinct attachment with its required filename.']);
  }
  if (selected.reduce((sum, item) => sum + item.size, 0) > MAX_RAW) {
    throw stop('incomplete', 'The selected execution attachments exceed the 1 MiB raw-data limit.', ['Use a smaller complete saved parent/child call for each case; retain its full saved provenance.']);
  }
  return selected;
}

function pointer(...tokens) {
  return '/' + tokens.map(value => String(value).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function ref(attachment, ...tokens) {
  return { attachmentId: attachment.id, path: pointer(...tokens) };
}

function auditPair(parent, child, parentFile, childFile) {
  let report;
  try {
    report = auditBoundary(parent, child);
  } catch (error) {
    return { status: 'incomplete', reason: error.message, parentAttachmentId: parentFile.id, childAttachmentId: childFile.id };
  }
  const runs = child.data.resultData.runData;
  const terminal = child.data.resultData.lastNodeExecuted;
  const terminalRun = runs[terminal].length - 1;
  const trigger = Object.entries(runs).find(([, tasks]) => tasks.some(task => !task.source.some(edge => edge?.previousNode)))[0];
  const input = report.caller_input;
  const findings = report.findings.slice(0, MAX_FINDINGS).map(finding => ({
    ...finding,
    raw: {
      parentPairing: ref(parentFile, 'data', 'resultData', 'runData', report.node, report.run, 'data', 'main', finding.output, finding.item, 'pairedItem'),
      childTerminalPairing: ref(childFile, 'data', 'resultData', 'runData', terminal, terminalRun, 'data', 'main', finding.output, finding.item, 'pairedItem'),
      callerInputs: finding.expected.map(pair => ref(parentFile, 'data', 'resultData', 'runData', input.node, input.run, 'data', 'main', input.output, pair.item, 'json')),
    },
  }));
  return {
    ...report,
    findings,
    truncated: report.findings.length > findings.length,
    raw: {
      parentCall: ref(parentFile, 'data', 'resultData', 'runData', report.node, report.run, 'metadata', 'subExecution'),
      childParent: ref(childFile, 'data', 'resultData', 'runData', trigger, 0, 'metadata', 'parentExecution'),
      childInput: ref(childFile, 'data', 'resultData', 'runData', trigger, 0, 'data', 'main', 0),
    },
  };
}

function adfText(node) {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return Array.isArray(node.content) ? node.content.map(adfText).join(node.type === 'doc' ? '\n' : '') : '';
}

function makeComment(result, marker) {
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  for (let shown = MAX_FINDINGS; shown >= 0; shown--) {
    const compact = report => ({
      ...report,
      findings: report.findings.slice(0, shown),
      shown_findings: Math.min(report.findings.length, shown),
      truncated: report.checked_items > Math.min(report.findings.length, shown),
    });
    const caseFile = {
      auditVersion: AUDIT_VERSION,
      issue: result.issue,
      attachments: result.attachments,
      before: compact(result.before),
      after: compact(result.after),
    };
    const body = {
      body: {
        type: 'doc', version: 1,
        content: [
          paragraph('Saved n8n boundary ancestry audit'),
          paragraph(`Before: ${result.before.status} (${result.before.mismatches}/${result.before.checked_items} mismatches). After: ${result.after.status} (${result.after.mismatches}/${result.after.checked_items} mismatches).`),
          paragraph('Scope: one recorded successful, waiting, once-mode Execute Workflow 1.2 call. HTTP/business acceptance remains a separate evidence contract. Raw item JSON stays in the original attachments.'),
          paragraph(marker),
          { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(caseFile, null, 2) }] },
        ],
      },
    };
    if (bytes(JSON.stringify(body)) <= MAX_COMMENT) return body;
  }
  throw stop('incomplete', 'The compact evidence comment exceeds 16 KiB.', ['Use a smaller saved call with shorter node identifiers while retaining complete execution provenance.']);
}

function boundedResult(result) {
  if (bytes(JSON.stringify(result)) <= MAX_RESULT) return result;
  const count = report => report && ({ status: report.status, checked_items: report.checked_items, mismatches: report.mismatches });
  return {
    status: 'incomplete', auditVersion: AUDIT_VERSION, issue: result.issue,
    attachments: result.attachments.map(({ role, name, id, size }) => ({ role, name, id, size })),
    before: count(result.before), after: count(result.after), commentId: result.commentId,
    writebackStatus: result.writebackStatus,
    reason: 'The audit result exceeds the 64 KiB delivery limit.',
    nextSteps: ['Use a smaller complete saved call for this case and rerun; keep the original attachment evidence.'],
  };
}

// The only injected boundary is the Forge API package, used by the local check.
// The deployed export below always loads @forge/api itself.
function createAuditIssue(forgeApi) {
  return async function auditIssue(payload, context) {
    const deadline = Date.now() + 45_000;
    let fetchedBytes = 0;
    let rawBytes = 0;
    let mutationAttempted = false;
    const result = {
      status: 'incomplete', auditVersion: AUDIT_VERSION, issue: null, attachments: [],
      before: null, after: null, commentId: null, writebackStatus: 'not-written', nextSteps: [],
    };
    try {
      const principal = context?.principal?.accountId;
      if (typeof principal !== 'string' || !principal.trim()) {
        throw stop('auth-required', 'The invocation has no trusted current-user principal.', ['Connect this MCP client through Atlassian OAuth as the user who can access the Jira issue, then retry.']);
      }
      const issueKey = typeof payload?.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
      if (issueKey.length > 64 || !ISSUE_KEY.test(issueKey)) {
        throw stop('incomplete', 'Provide a Jira issue key such as N8N-1.', ['Call this tool with {"issueKey":"YOURPROJECT-123"}.']);
      }
      const api = forgeApi.default || forgeApi;
      const route = forgeApi.route;
      if (typeof api.asUser !== 'function' || typeof route !== 'function') {
        throw stop('auth-required', 'The Forge current-user Jira API is unavailable.', ['Install the supported @forge/api dependency and reconnect this app through Atlassian OAuth.']);
      }
      // Remote MCP has no UI-Kit consent flow. Bind offline impersonation
      // exclusively to the trusted Forge principal, never a tool argument.
      const jira = api.asUser(principal);

      async function request(path, options, stage, raw = false) {
        const writing = options?.method === 'POST';
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw stop('incomplete', 'The 45-second audit deadline was reached.', ['Rerun the same issue; the tool searches its saved case marker before creating another comment.']);
        const signal = AbortSignal.timeout(Math.min(8_000, remaining));
        if (writing) mutationAttempted = true;
        try {
          const response = await jira.requestJira(path, {
            ...options, signal, redirect: 'manual',
            headers: { Accept: raw ? '*/*' : 'application/json', ...(writing ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
          });
          const expected = writing ? 201 : 200;
          if (response.status !== expected) {
            const status = response.status;
            if (status === 401) throw stop('auth-required', `${stage} requires current-user authorization.`, ['Reconnect this MCP client through Atlassian OAuth to the installed Jira site, then retry.'], writing ? 'forbidden' : undefined);
            if (status === 403) throw stop('forbidden', `${stage} was denied by Jira permissions or app access rules.`, [writing ? 'Grant the invoking user Add comments on this issue, then rerun the same case.' : 'Grant the invoking user Browse projects and the applicable issue/attachment visibility permissions, then retry.'], writing ? 'forbidden' : undefined);
            if (status === 404) throw stop('unavailable', `${stage} returned 404.`, [`Open ${issueKey} as the invoking user and verify that this issue and its saved attachments are available.`, 'Rerun with the canonical issue key and the four required filenames.'], writing ? 'failed' : undefined);
            if (status === 429) {
              const retryAfter = Number(response.headers?.get?.('Retry-After'));
              throw stop('rate-limited', `${stage} was rate limited.`, [Number.isFinite(retryAfter) && retryAfter > 0 ? `Retry after ${retryAfter} seconds using the same issue key.` : 'Retry after the Jira Retry-After interval using the same issue key.'], writing ? 'failed' : undefined);
            }
            throw stop(writing ? 'writeback-failed' : 'incomplete', `${stage} returned HTTP ${status}; expected ${expected}.`, [raw ? 'The attachment read requires complete Jira content with redirect=false and HTTP 200. Re-export and attach the complete saved execution.' : 'Check the issue delivery constraints and rerun the same case; the marker is checked before another comment is created.'], writing ? (status >= 500 ? 'unknown' : 'failed') : undefined);
          }
          const text = await response.text();
          const size = bytes(text);
          fetchedBytes += size;
          if (raw) rawBytes += size;
          if (fetchedBytes > MAX_FETCHED || (raw && rawBytes > MAX_RAW)) {
            throw stop('incomplete', raw ? 'Downloaded execution JSON exceeds the 1 MiB raw-data limit.' : 'Jira response data exceeds the 4 MiB read budget.', ['Use a smaller complete saved call or a dedicated issue with a shorter comment history, then rerun.'], writing ? 'unknown' : undefined);
          }
          if (raw) return text;
          try { return JSON.parse(text); } catch {
            throw stop(writing ? 'writeback-failed' : 'incomplete', `${stage} returned an unreadable JSON response.`, ['Rerun the same issue to inspect its saved marker before another write.'], writing ? 'unknown' : undefined);
          }
        } catch (error) {
          if (error.deliveryError) throw error;
          const status = Number(error.statusCode ?? error.status);
          if (status === 401 || status === 403) {
            throw stop(status === 401 ? 'auth-required' : 'forbidden', `${stage} requires current-user Jira access.`, ['Reconnect through Atlassian OAuth and grant the invoking user access to this issue and Add comments for delivery.'], writing ? 'forbidden' : undefined);
          }
          throw stop(writing ? 'writeback-failed' : 'incomplete', `${stage} ${signal.aborted ? 'timed out' : 'request failed'}.`, ['Rerun the same issue; an existing case marker is checked before another comment is created.'], writing ? 'unknown' : undefined);
        }
      }

      const issue = await request(route`/rest/api/3/issue/${issueKey}?fields=attachment,summary`, {}, 'Read issue');
      if (!JIRA_ID.test(String(issue.id)) || typeof issue.key !== 'string' || issue.key.length > 64 || !ISSUE_KEY.test(issue.key)) {
        throw stop('incomplete', 'Jira returned no canonical issue ID/key.', ['Verify the issue key on the installed Jira site and rerun.']);
      }
      result.issue = { id: String(issue.id), key: issue.key };
      const selected = selectAttachments(issue);
      result.attachments = selected;
      const saved = {};
      for (const file of selected) {
        const raw = await request(route`/rest/api/3/attachment/content/${file.id}?redirect=false`, {}, `Read ${file.name}`, true);
        try { saved[file.role] = JSON.parse(raw); } catch {
          throw stop('incomplete', `${file.name} is invalid execution JSON.`, exportSteps(file.role));
        }
        file.executionId = saved[file.role]?.id === undefined ? null : String(saved[file.role].id);
        file.workflowId = saved[file.role]?.workflowId === undefined ? null : String(saved[file.role].workflowId);
      }
      result.before = auditPair(saved['original-parent'], saved['original-child'], selected[0], selected[1]);
      result.after = auditPair(saved['repaired-parent'], saved['repaired-child'], selected[2], selected[3]);
      const incomplete = [
        { label: 'Original', roles: FILES.slice(0, 2), report: result.before },
        { label: 'Repaired', roles: FILES.slice(2), report: result.after },
      ].filter(item => item.report.status === 'incomplete');
      if (incomplete.length) {
        throw stop('incomplete', incomplete.map(item => `${item.label} case: ${item.report.reason}`).join(' '), incomplete.flatMap(item => [
          `${item.label}: use matching ${item.roles.map(role => `${role}.json`).join(' and ')} from the same saved instance; verify workflow IDs against both saved call edges.`,
          'Export both complete execution responses with GET /api/v1/executions/<id>?includeData=true; retain runData and workflowData.',
          `Replace those ${item.label.toLowerCase()} case attachments using their required filenames, then rerun.`,
        ]));
      }
      result.status = 'audited';
      result.caseMarker = [AUDIT_VERSION, result.issue.id, ...selected.map(file => `${file.role}=${file.id}`)].join('|');
      if (bytes(JSON.stringify(result)) > MAX_RESULT) {
        throw stop('incomplete', 'The audit result exceeds the 64 KiB delivery limit.', ['Use a smaller complete saved call for this case and rerun.']);
      }
      const body = makeComment(result, result.caseMarker);
      const caseText = adfText(body.body);
      let existing = null;
      let offset = 0;
      let scanned = false;
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const page = await request(route`/rest/api/3/issue/${result.issue.id}/comment?startAt=${offset}&maxResults=100`, {}, 'Read evidence comments');
        if (!Array.isArray(page.comments) || !Number.isSafeInteger(page.total) || page.total < 0) {
          throw stop('incomplete', 'Jira returned incomplete comment pagination.', ['Rerun this issue after its comment history is available.']);
        }
        existing = page.comments.find(comment => comment.author?.accountId === principal && JIRA_ID.test(String(comment.id)) && adfText(comment.body) === caseText);
        if (existing) break;
        offset = Number.isSafeInteger(page.startAt) ? page.startAt : offset;
        offset += Number.isSafeInteger(page.maxResults) && page.maxResults > 0 ? page.maxResults : Math.max(page.comments.length, 100);
        if (offset >= page.total) { scanned = true; break; }
      }
      if (!existing && !scanned) {
        throw stop('incomplete', 'The comment history exceeds the five-page idempotency scan.', ['Use a dedicated Jira issue for this saved-execution set, attach its four files, and rerun.']);
      }
      const current = await request(route`/rest/api/3/issue/${result.issue.id}?fields=attachment`, {}, 'Recheck saved attachments');
      const currentFiles = selectAttachments(current);
      if (String(current.id) !== result.issue.id || currentFiles.some((file, index) => file.id !== selected[index].id)) {
        throw stop('evidence-changed', 'The selected issue attachment IDs changed during this audit.', ['Rerun this issue to audit its current four-file evidence set.']);
      }
      if (existing) {
        result.commentId = String(existing.id);
        result.writebackStatus = 'reused';
        result.writebackAuthorMatched = true;
        return boundedResult(result);
      }
      if (deadline - Date.now() < 1000) {
        throw stop('incomplete', 'The 45-second audit deadline was reached before comment creation.', ['Rerun the same issue; its saved marker is checked first.']);
      }
      const comment = await request(route`/rest/api/3/issue/${result.issue.id}/comment`, { method: 'POST', body: JSON.stringify(body) }, 'Add evidence comment');
      result.commentId = JIRA_ID.test(String(comment.id)) ? String(comment.id) : null;
      result.writebackAuthorMatched = comment.author?.accountId === principal;
      if (!result.commentId || !result.writebackAuthorMatched) {
        throw stop('auth-mismatch', 'The created comment has no verified current-user author/ID.', ['Inspect the returned issue comment and reconnect the MCP current-user authorization before the next call.'], 'unverified');
      }
      result.writebackStatus = 'created';
      return boundedResult(result);
    } catch (error) {
      result.status = error.deliveryError ? error.status : 'incomplete';
      result.reason = error.deliveryError ? error.message : 'The saved-execution audit stopped before verified delivery.';
      result.nextSteps = error.deliveryError ? error.nextSteps : ['Verify the current-user Jira connection and the four complete saved execution files, then rerun.'];
      result.writebackStatus = error.writebackStatus || (mutationAttempted ? 'unknown' : 'not-written');
      return boundedResult(result);
    }
  };
}

async function auditIssue(payload, context) {
  return createAuditIssue(require('@forge/api'))(payload, context);
}

module.exports = { auditIssue, createAuditIssue };
