# n8n Execution Dossier

A successful n8n run can still return an item attributed to the wrong customer. Put the saved executions on your Jira change issue. Your existing MCP agent can reconstruct their recorded ancestry and leave a before/after evidence case on that same issue.

The app uses native Forge functions, Jira attachments and Jira comments. It imports the existing [recorded-boundary auditor](../experiments/lineage-boundary/audit-executions.cjs) directly; item JSON stays in its original Jira attachments.

## One issue, one reproducible case

1. Attach four complete API execution exports:
   - `original-parent.json`
   - `original-child.json`
   - `repaired-parent.json`
   - `repaired-child.json`
2. Connect the app's MCP endpoint through Atlassian OAuth.
3. Ask your agent to call **Audit saved n8n executions** with `{"issueKey":"YOURPROJECT-123"}`.
4. Read the before/after findings and evidence comment on the issue.

Each finding includes the parent `pairedItem` JSON pointer, the saved child terminal pointer, expected caller-input locations, and the corresponding Jira attachment IDs. The case also identifies both directions of the actual parent/child call edge. Execution IDs are retained alongside workflow IDs and file roles, including when two instances reuse the same numeric IDs.

A serial rerun by the same user reuses its evidence comment. A replacement attachment gets a new case marker. Missing or ambiguous exports return the specific filenames and export steps before delivery.

The [four synthetic saved fixtures](../experiments/lineage-boundary/recorded/) demonstrate two original ancestry mismatches and a consistent repaired call. The accompanying [native HTTP reproduction](../experiments/lineage-boundary/) records the actual wrong-customer request and its repair.

## Install a development build

Use Node.js 24 and the [Forge setup guide](https://developer.atlassian.com/platform/forge/getting-started/). Atlassian provides a [Cloud Developer Bundle](https://go.atlassian.com/cloud-dev) for development and testing.

From this directory:

```sh
npm ci
npm run check
forge register "n8n Execution Dossier" --developer-space-id YOUR_SPACE_ID --accept-terms
forge deploy --environment development
forge install --environment development --site YOUR_SITE.atlassian.net --product jira --confirm-scopes
```

Registering assigns your checkout its own Forge app ID. In Atlassian Administration, open **Apps → Sites → your site → Connected apps → this app → Tools** and enable the tool for external clients.

The endpoint is:

```text
https://mcp.atlassian.com/forge/APP_UUID_FROM_YOUR_MANIFEST
```

For example, in Codex:

```sh
codex mcp add n8n-dossier --url https://mcp.atlassian.com/forge/APP_UUID
codex mcp login n8n-dossier
```

Choose the installed site during OAuth. Requests read and write Jira **as the invoking user**. The app enables offline impersonation for `read:jira-work` and `write:jira-work` and binds it exclusively to the authenticated Forge invocation principal. Jira project, issue and comment permissions remain the delivery boundary. Created comments include a verified current-user author. This avoids the separate UI consent entry currently required by remote `asUser()` calls in the [MCP preview](https://developer.atlassian.com/platform/forge/read-jira-issues-with-a-rovo-mcp-tool/).

Development installs are available to app contributors. Use Forge direct distribution for other users and sites.

## Evidence scope

The auditor covers completed successful executions with full saved `runData` and `workflowData`: one waiting, once-mode Execute Workflow **1.2** call and one passthrough child trigger. Export through `GET /api/v1/executions/<id>?includeData=true`, taking the actual child ID from the parent call metadata.

The adapter accepts up to **1 MiB** across the four raw files and returns up to **20 findings per pair**, with total counts and truncation fields. Recorded ancestry and HTTP/business acceptance have separate evidence: verify the endpoint request and the agreed business outcome alongside this dossier.

## Status and source

The development app has passed normal Forge deployment, installation, external MCP OAuth and a [live evidence case](native-case.json). Two real MCP calls created and then reused the same Jira comment: two original ancestry mismatches, a consistent repaired case, and a verified invoking-user author. Direct distribution and production installation are being prepared.

MIT. [Source and n8n delivery work](https://github.com/blucca/n8n-check).
