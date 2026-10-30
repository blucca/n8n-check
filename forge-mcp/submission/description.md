# n8n Execution Dossier

**Tagline:** Turn saved n8n executions into a reviewable before/after case on your Jira change issue.

**Category:** Software Development — Apps for Software Teams  
**Bonus prize:** Best app with Atlassian MCP

## Inspiration

An agency technical lead is responsible for the customer impact of an automation change. A green execution and a plausible output are easy to review; the ancestry of that output takes more work.

Our native n8n reproduction made this concrete. Four synthetic customers bought the same product and quantity. A child workflow selected customers D and C, while the parent addressed the outgoing requests to A and B. Both workflows succeeded, and all eleven business-node JSON snapshots stayed identical across the branch change. The fault lived in the saved item-linking metadata.

That led to a focused product: put the original and repaired execution records on the Jira change issue, then give the team's existing MCP agent a deterministic audit tool. A reviewer gets the verdict and the exact saved evidence together.

## What it does

Attach four complete saved execution exports to a Jira issue:

- `original-parent.json`
- `original-child.json`
- `repaired-parent.json`
- `repaired-child.json`

Ask **Audit saved n8n executions** to audit the issue key. The tool reads the attachments as the authenticated Jira user, checks both directions of each recorded parent/child call, and reconstructs the returned items' ancestry through the saved execution graph.

For every finding it returns the expected and recorded input indices, Jira attachment IDs, and exact JSON pointers to the parent pairing, child terminal pairing, and expected caller input. It also identifies the saved call edges and retains execution and workflow IDs. The fixture deliberately reuses execution IDs 3 and 4 across the original and repaired instances; workflow IDs and both call edges keep the pairs grounded in their actual records.

The tool writes a compact before/after dossier as a native Jira comment on the same issue. Raw customer JSON stays in the original attachments. A serial rerun by the same user reuses the matching comment; replacement attachment IDs produce a new case marker. Missing, ambiguous, or unsupported evidence returns specific export and attachment steps before case delivery.

The supported scope is one completed successful, waiting, once-mode **Execute Workflow 1.2** call, with a passthrough child trigger and complete saved `runData` and `workflowData`. HTTP requests and agreed business outcomes have their own acceptance evidence alongside the ancestry dossier.

## How we built it

The Forge app was built during Codegeist. Its `rovo:mcp` module exposes one `action`, backed by a native Forge function running Node.js 24. Jira provides the attachment store, permissions, comment delivery, and review interface.

The handler directly imports our existing MIT-licensed recorded-boundary auditor. That shared core follows the paired item's actual input edge, including the producer output and run, then compares the reconstructed ancestry with the parent record. The Forge adapter adds authenticated retrieval, four-file selection, bounded processing, raw-evidence pointers, native Atlassian Document Format comments, and serial case reuse.

Jira calls use `@forge/api` and `asUser(principal)`, with the principal taken from trusted Forge invocation context. The manifest enables impersonation for the two Jira work scopes. Project visibility, attachment access, and Add comments permission govern delivery. Before writing, the handler rechecks the attachment IDs; after writing, it verifies the comment's invoking-user author.

**AI builder:** This app and submission were built by OpenAI Codex. Audit verdicts are computed by the deterministic auditor against the saved records.

## Challenges we ran into

- **Preserving the evidence:** A merged node-output summary loses the task sources and saved call metadata needed for this audit. Complete API exports retain those records and provide actionable recovery steps when a file is missing.
- **Remote current-user authorization:** The MCP preview's separate UI consent requirement initially stopped Jira reads. We followed Forge's supported impersonation path and bound it to the authenticated invocation principal.
- **Native attachment delivery:** Jira's JSON attachment endpoint returned HTTP 406 for the initial media type. Adjusting content negotiation allowed the actual raw files to reach the same auditor.
- **A durable, repeatable case:** Exact comment content, audit version, canonical issue ID, attachment IDs, and invoking-user authorship make serial reruns reuse the saved dossier. An attachment recheck keeps the written case tied to the inspected files.

## Accomplishments that we're proud of

The hosted production app completed installation through its public Forge direct-sharing link, site-admin tool enablement, and three real external MCP calls on the same synthetic `KAN-2` issue. The first call named the missing export and returned executable steps with `not-written`. After the four saved exports were attached, the next call found **two original ancestry mismatches** and **zero repaired mismatches**, created comment `10001`, and verified its invoking-user author. The final call returned `reused` with that same comment ID and verified author.

The production app is version 2.0.0 and is Runs on Atlassian eligible. The source, four saved fixtures, and redacted production request/result evidence are public and MIT-licensed. The earlier development case on `KAN-1` remains available.

The complete experience uses the MCP client and Jira interface the team already has: collect evidence, receive the diagnosis, inspect the raw locations, and review the saved before/after case on the change issue.

## What we learned

Item identity is part of an automation's behavior. In this reproduction, output JSON looked stable while the request recipients changed. Saved provenance made that discrepancy reproducible.

We also learned to make the handoff as useful as the verdict. Naming the missing export, returning the precise attachment and JSON path, and preserving the case on the team's issue gives an operator concrete work to do and a reviewer evidence to inspect.

## What's next

The next step is an agency technical lead's first trial with their own saved execution records. We will measure the time to locate a boundary mismatch and complete a Jira review, then refine the export guidance from that experience. Additional workflow shapes will receive explicit saved-evidence contracts as real cases establish the need.

## Best app with Atlassian MCP — bonus write-up

The app exposes **Audit saved n8n executions** through Atlassian's MCP server using `rovo:mcp`. Its single input is a Jira issue key. An existing third-party MCP agent can invoke the native Forge function through Atlassian OAuth and receive a structured, evidence-addressable result.

MCP is the working entry point for the entire task: select the team's change issue, retrieve its four saved exports under the caller's Jira permissions, reconstruct the actual recorded ancestry, deliver the before/after case back to the issue, and return precise raw locations or executable next steps. This equips an agent to investigate an automation change while keeping the team review in Jira. The live production calls demonstrate missing-evidence recovery, authenticated execution, native writeback, verified authorship, and serial reuse end to end.

## Source and judge access

- [Source, installation link, and complete setup instructions](https://github.com/blucca/n8n-check/tree/main/forge-mcp)
- [Synthetic saved execution fixtures](https://github.com/blucca/n8n-check/tree/main/experiments/lineage-boundary/recorded)
- [Redacted live production case](https://github.com/blucca/n8n-check/blob/main/forge-mcp/production-case.json)
- [Earlier live development case](https://github.com/blucca/n8n-check/blob/main/forge-mcp/native-case.json)

Install the hosted app through the public link in the README. A site administrator enables the tool in **Connected apps → n8n Execution Dossier → Tools**. Connect the app's endpoint through Atlassian OAuth in an MCP client, choose the installed site, attach the four fixtures to an issue in the judge's own Jira environment, and call the tool with that issue key.

```text
https://mcp.atlassian.com/forge/df78f02a-e4d8-4536-9eca-c2907155a95b
```

