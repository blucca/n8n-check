# n8n Execution Dossier

A successful n8n run can still return an item attributed to the wrong customer. Put the saved executions on your Jira change issue. Your existing MCP agent can reconstruct their recorded ancestry and leave a before/after evidence case on that same issue.

The app uses native Forge functions, Jira attachments and Jira comments. It imports the existing [recorded-boundary auditor](../experiments/lineage-boundary/audit-executions.cjs) directly; item JSON stays in its original Jira attachments.

[Watch the 2:45 production demonstration](https://youtu.be/ICBeWnsio1M) — missing export → two exact ancestry mismatches → repaired case → same-comment reuse. [Video, captions and transcript](demo/). [Codegeist entry](https://devpost.com/software/n8n-execution-dossier).

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

## Install the hosted app

[Install n8n Execution Dossier on Jira](https://developer.atlassian.com/console/install/df78f02a-e4d8-4536-9eca-c2907155a95b?signature=AYABeH34NBrtelSttm%2BeJYmDdKUAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBRIpo9qEScM%2FJB%2BMA%2BB0DKwAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDC0kwnByTaXb2MJ1ZwIBEIA7Gnq5%2FXpWnzkV%2BSKHmU01zlsEQCPPsVLduKLHWDBMoWULXNxoH0oQU1FZHqbwYmsMT1y9oIxLmu4TJzAAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHDlMeRCEAdVTy%2FDISkiIlTAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMoA8WlSmOXpLCoon8AgEQgDv1XhhKyXWaU9aLImzK2Y6DjS8D5E9aFSVU7LH4eStS%2FigaMTX6%2BTjqrOqIZSvWgr1M1%2BTlgnMISGOOmAAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATb2rTOdYkexivwiBSmYy0YAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzhFEYhKRjhJudR3oICARCAO23tILBZFErQw3GXRb3lgbVWmy4J7q1oMi8TBGdx5UT6mOq7yJUt9DWm1j01PTxSCsVGEUO6nt%2BcwEoxAgAAAAAMAAAQAAAAAAAAAAAAAAAAAN7jzmvp9VZZnyxHDzL%2B0%2Bf%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJEJ11zHRzE1OxWgcQTYRpEoGcPRo2lfntT27X%2FWbWiNFfQ2HZ1PK7JxwlU%2FCrhHZ4hvD7nVpEysDEQxqEgDHHoVTg%3D&product=jira). A site administrator installs the app and enables its tool under **Connected apps → this app → Tools**. Then connect the MCP endpoint through Atlassian OAuth and use `{"issueKey":"YOURPROJECT-123"}`.

```text
https://mcp.atlassian.com/forge/df78f02a-e4d8-4536-9eca-c2907155a95b
```

The Forge-hosted production app is free to install. Your own Jira and MCP-client subscriptions remain under your accounts.

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

## Data and permissions

The app reads the four saved execution attachments on the issue selected by the authenticated user. Processing runs in Forge; the app has no external datastore or external network egress. It writes a compact audit comment back to Jira. Original item JSON remains in its attachments. Your MCP client receives execution/workflow IDs, item indices, ancestry pointers and verdicts. The app emits no execution contents or account identifiers in application logs.

Site administrators control installation and tool exposure. Jira visibility and comment permissions apply to every call. Remove the app through Atlassian Administration to stop future access; remove an audit comment through Jira to delete that saved report. The source is MIT-licensed. For support or a data-handling question, use the [repository issues](https://github.com/blucca/n8n-check/issues).

## Evidence scope

The auditor covers completed successful executions with full saved `runData` and `workflowData`: one waiting, once-mode Execute Workflow **1.2** call and one passthrough child trigger. Export through `GET /api/v1/executions/<id>?includeData=true`, taking the actual child ID from the parent call metadata.

The adapter accepts up to **1 MiB** across the four raw files and returns up to **20 findings per pair**, with total counts and truncation fields. Recorded ancestry and HTTP/business acceptance have separate evidence: verify the endpoint request and the agreed business outcome alongside this dossier.

## Status and source

The hosted production app (2.0.0) has passed installation through the public sharing link, site-admin tool enablement, and [three real external MCP calls](production-case.json). On one synthetic Jira issue: a missing export returned concrete steps without writing; attaching the four saved exports produced two original ancestry mismatches and a consistent repaired case; a serial rerun reused the same comment with verified invoking-user authorship. The earlier [development evidence case](native-case.json) is also available.

MIT. [Source and n8n delivery work](https://github.com/blucca/n8n-check).
