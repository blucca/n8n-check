# Local Entity Proof — research proposal

**Keep AI actions tied to the right person and record.**

Status: a proposed funded phase. The current narrow auditor and runtime lab are available now; the portable adapters and independent operator phase begin with an agreed grant. This document describes that next phase.

## A runnable starting point

The [lineage-boundary lab](../experiments/lineage-boundary) reproduced an identity failure in a real n8n runtime using fictional customers. Eleven business-node JSON outputs were unchanged, and both parent and child runs succeeded. The second input batch intended HTTP actions for D/C; the actual actions went to A/B.

The local auditor follows consumer inlets, producer outputs, repeated runs and complete ancestor sets. In the original recorded capture it finds expected caller roots `[3] / [2]` against recorded `[0] / [1]`; the repaired capture agrees. Evidence gaps receive an explicit `incomplete` finding.

[PortProof](https://github.com/blucca/portproof) independently implements the kernel in native Fe with typed coordinates and complete root-set traversal. Its first edition covers one completed, successful, waiting once-mode Execute Workflow 1.2 call, a passthrough trigger, bilateral IDs and complete saved records. That scope is the working foundation for the proposal.

## The next capability

A portable local correctness layer beside an agent’s tools:

```text
recorded source coordinates
         ↓
selected person / entity
         ↓
returned record and its full ancestry
         ↓
intended action destination
         ↓
consistent / mismatch / incomplete + source coordinates
```

Target users are self-hosted automation builders and small service or community-service teams handling customer and beneficiary records. Initial operator recruitment targets builders in mainland China and multilingual n8n communities. The audit engine stays local and CPU-only; the funded default uses a local open-model tool runner. Operators retain their raw data.

## One complete twelve-week phase

1. **Weeks 1–3: contract and corpus.** Publish a runtime-independent source-coordinate and entity-binding contract and 48 cases across fan-out, valid many-to-one merges, repeated runs, cross-call IDs, changed payloads and missing evidence. Fix an evaluation split before adapter development.
2. **Weeks 4–7: two local tool paths.** Ship a CLI and Node/Python tool adapters for recorded n8n calls and a local open-model Python tool runner. Return actionable findings and source coordinates.
3. **Weeks 8–10: independent operator workflows.** Process three independently operated workflows using consented, redacted exports and operator-labelled intended recipients. Measure wrong-recipient detection, legitimate-merge preservation, intervention outcomes, latency and memory on modest CPU hardware.
4. **Weeks 11–12: complete release.** Publish the MIT code, corpus, evaluation scripts, integration examples, operator guide and three candid case reports.

Compare payload/status checks and complete provenance checks on the same fixed cases. Complete wrong-recipient cases must produce `mismatch`, valid associations must remain `consistent`, and evidence gaps must produce `incomplete`. Operator reports also identify cases where intended destinations need extra business context.

## Why openness matters

Builders need to inspect the engine, reproduce a finding, adapt it to their tool runner and audit sensitive records locally. The contract, core, adapters, synthetic corpus and evaluation will be MIT-licensed. The current n8n-check implementation and lab captures already use MIT. Published examples use fictional or consented redacted data.

Current proof consists of reproducible runtime captures and public source. External production deployments and paying customers for this layer are zero. Research and engineering are frontier-Codex-led; the responsible human account owner handles grants and payment.
