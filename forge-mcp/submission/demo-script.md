# n8n Execution Dossier — 2:45 demonstration

**Target duration:** 165 seconds. All narrated actions and the complete result appear before 3:00.  
**Primary case:** synthetic Jira issue `KAN-2`, using the four existing saved execution fixtures.  
**Screens:** captured real request/result exchanges from the external MCP client (`gain-native-verifier`), native Jira issue/attachments/comments, and Atlassian's installation and tool settings.

## Recording setup

Have the authenticated MCP client, `KAN-2`, its original/repaired attachments, and the public install instructions ready in tabs. Use the actual tool name returned by `tools/list`; its display name is **Audit saved n8n executions**. The demonstrated input is `{"issueKey":"KAN-2"}`.

Keep the fixture data synthetic (`customer-A` through `customer-D`). Frame or crop out personal profiles, email addresses, account IDs, API credentials, and OAuth exchange URLs. The public installation link and public MCP endpoint can be shown. Film actual requests, returned results, and Jira content; cut network waits between those real actions.

The production rehearsal is complete on this one synthetic issue. Its real first call returned `incomplete` and `not-written` with the missing filename and export steps. The four fixtures were then attached: original parent/child IDs `10004`/`10005`, repaired parent/child IDs `10006`/`10007`. The subsequent real calls returned `created` then `reused`, both for comment `10001` with verified invoking-user authorship. Preserve these captured request/results; replay their actual values in the recording rather than sending another case-creation call. The installed production app is 2.0.0 with Tools enabled.

## 0:00–0:14 — The customer problem

**Real picture and action:** Open `KAN-2` in Jira. Show the synthetic automation-change summary, then the four execution attachments. Keep the issue key visible.

**Narration:**

> A green n8n run can still address the wrong customer. This is n8n Execution Dossier, for agency technical leads who need to review an automation change on the Jira issue where the team already works.

## 0:14–0:34 — A missing export gives concrete work

**Real picture and action:** Show the genuine missing-export tool call and its `status: "incomplete"`, `reason`, `nextSteps`, and `writebackStatus: "not-written"`. Focus on the filename, the `GET /api/v1/executions/<id>?includeData=true` instruction, and the parent `metadata.subExecution` child-ID instruction. Then show the four attachments subsequently added to that same `KAN-2` issue.

**Narration:**

> Start with the saved evidence. If a required execution is missing, the tool returns its filename and concrete export steps. Fetch the complete execution with includeData set to true, take the child ID from the parent's saved call metadata, and attach the file.

## 0:34–0:55 — Audit four raw executions

**Real picture and action:** Show `original-parent.json`, `original-child.json`, `repaired-parent.json`, and `repaired-child.json` on `KAN-2`. Show the captured real MCP request to **`audit-n8n-issue`**, containing `{"issueKey":"KAN-2"}`, then the returned `status: "audited"`, four attachment roles/IDs, and both before/after results.

**Narration:**

> Here is the complete synthetic case, KAN-2: original and repaired parent and child exports. I call the MCP tool with this issue key. Forge reads all four attachments as the authenticated Jira user and verifies the actual parent-child call edges.

## 0:55–1:31 — Two mismatches, each with a raw route

**Real picture and action:** In the captured real result, show `before.mismatches: 2` and `after.status: "consistent"`. Expand both original findings. On item 0, hold on `expected.item: 3`, `observed.item: 0`, and its three `raw` locations. Open the original parent attachment to the `Orders` item 3 synthetic customer D and the recorded `Call` item 0 pairing. Return to item 1's `expected.item: 2` / `observed.item: 1`. Finish on the repaired expected/observed pairs 3→3 and 2→2.

**Narration:**

> The original has two mismatches. Returned item zero should trace to input three, customer D, but the parent recorded input zero, customer A. Item one should trace to input two, customer C, but recorded input one, customer B. Each finding gives the attachment ID and exact JSON pointer: the parent pairing, child terminal pairing, and expected caller input. The repaired saved call agrees for both items.

**Exact existing item-0 references for the close-up:**

```text
Parent pairing — attachment 10004
/data/resultData/runData/Call/0/data/main/0/0/pairedItem

Child terminal pairing — attachment 10005
/data/resultData/runData/Return/0/data/main/0/0/pairedItem

Expected caller input — attachment 10004
/data/resultData/runData/Orders/0/data/main/0/3/json
```

## 1:31–1:56 — A case the team can review on the same issue

**Real picture and action:** Return to `KAN-2`, refresh its comments, and show **Saved n8n boundary ancestry audit**. Hold on **Before: mismatch (2/2 mismatches). After: consistent (0/2 mismatches).** Scroll into the native JSON code block to show file roles, execution/workflow IDs, case marker, and the raw pointers. Show the issue's attachments beside the comment.

**Narration:**

> Open the same issue. The tool has left a native Jira comment with the before-and-after counts, matched execution and workflow IDs, and raw-evidence locations. Reviewers can open the original attachments to check the result. The customer JSON stays in those files. HTTP acceptance remains a separate check.

## 1:56–2:17 — Repeat the task; reuse the case

**Real picture and action:** Show the captured second successful call to the same tool with `{"issueKey":"KAN-2"}`. Hold on `writebackStatus: "reused"`, `commentId: "10001"`, and `writebackAuthorMatched: true` when those are the real returned values. Refresh Jira and show the existing case comment. Keep personal author details outside the frame.

**Narration:**

> Run the same audit again. It returns reused and the same comment ID, with the invoking user's authorship verified. This preserves one case for these attachments and this user. Replacing an attachment gives the next case its own marker.

## 2:17–2:45 — Install and use it in your own Jira environment

**Real picture and action:** Show the public Forge direct-sharing installation page for **n8n Execution Dossier**, the site's app installation details, and **Connected apps → this app → Tools** with the audit tool enabled. Show the public MCP endpoint and the README's OAuth/setup instructions. End on the `KAN-2` case comment and raw attachments. Installation/OAuth actions may use their genuine captured footage, with a cut past private identity screens.

**Narration:**

> To use it, open the public installation link, select your Jira site, and install. A site administrator enables the tool under Connected apps, then you connect this endpoint through Atlassian OAuth in your MCP client. Attach your saved executions and supply the issue key. The result is a reviewable n8n change case, delivered exactly where the team needs it.

**Endpoint to show:**

```text
https://mcp.atlassian.com/forge/df78f02a-e4d8-4536-9eca-c2907155a95b
```

The authoritative public installation URL is in `../install-url.txt`; the README includes complete hosted and development configuration instructions.
