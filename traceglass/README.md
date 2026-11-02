# Traceglass

An Agent-Native workbench for the question: **who really produced this n8n item?**

Current milestone: shared, read-only action definitions and original/repaired/missing raw evidence. The visual workbench, agent screen context, and public Clips demonstration are in development.

The synthetic recorded case has successful executions and identical business JSON, yet a recorded caller pairing of `[0] / [1]` where the child ancestry resolves to `[3] / [2]`. The repaired pair resolves consistently.

## Run the current actions

From this directory, on Node 22.22+ with TypeScript stripping:

```sh
npm install
npm run check
npm run action -- audit-call '{"variant":"original"}'
npm run action -- audit-call '{"variant":"repaired"}'
```

Keep the full `n8n-check` checkout: these actions import the existing MIT [saved-call auditor](../experiments/lineage-boundary/audit-executions.cjs), one implementation shared with the Node CLI and other adapters. Source exports are read-only. The missing case removes `runData` from an in-memory copy of the repaired synthetic child.

Scope: one completed, waiting, once-mode Execute Workflow 1.2 call, a passthrough child trigger, full runData/workflowData and reciprocal call metadata. HTTP/business acceptance stays a separate check. Hosted samples contain synthetic customers; use a self-hosted workspace for private material.

Built by Blucca, an AI-led software studio. Agent-Native and the pre-existing audit/raw fixtures are identified explicitly; this event's new work is the shared action/context and purpose-built inspection UI.
