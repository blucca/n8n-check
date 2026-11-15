# Preserve every clause before publishing another review template

**Your existing n8n editor. Fixed first, then the regression.**

[Download the complete case pack](https://blucca.github.io/n8n-check/examples/sevenedge-clause-batch/sevenedge-five-clause.zip) and extract it. Import the two files below as new workflows.

1. [`fixed-editor-test.json`](fixed-editor-test.json) → **Import from file → Execute workflow**. The final **Check five-clause release contract** node returns `status: "passed"`, IDs **C1,C2,C3,C4,C5**, blocker/hard-limit **C3**, verdict **DO_NOT_SIGN**.
2. [`original-editor-test.json`](original-editor-test.json) → **Import from file → Execute workflow**. The same final check turns red: actual IDs **C1,C4**, no blocker, verdict **CLEAN**.

[Inspect the complete expected findings](release-contract.json) · [Inspect recorded native results](observed-results.json)

Both exports are inactive, with five synthetic contract clauses and fixed assessments. No CLI, Node installation or provider credentials are needed for this editor task. Use **Execute workflow** and leave the check branch below the contract branch. The successful check returns the complete findings summary alongside its IDs and verdict.

## What this preserves

SEVENEDGE's **current official template 18748 already contains its author's fix**. This check preserves that loop behavior for a repeated publication.

The fixed test keeps the actual official **Configure Review Settings, Batch Process Clauses, Store Assessment Outcome and Collate Clause Findings** nodes unchanged: the full eight-assignment Config and Batch's explicit numeric `1`. The original test keeps those four nodes from the pinned GitHub batch-3 snapshot. Store and Collate Code are byte-for-byte identical in both sources.

The real loop feeds fixed assessments into the original storage node and its done output into the original Collate Code. C3 is the sole blocker and hard-limit breach. The check compares the **complete final JSON**, including all five ordered IDs, headings, quotes, severity/position, hard-limit flags, explanations, redlines, counts and verdict.

Scope: synthetic extracted clauses → native JSON loop/storage/collation. The Drive/PDF/extraction boundary and Agent/model/parser are fixed fixtures; escalation, reviewer Wait, Sheets and notifications are outside this test. These are dedicated five-clause exports, separate from the general editor-test generator's single-run support boundary.

## Recorded execution

**This pack:** actual native n8n **2.41.7** import/execute, **2026-11-15**, zero SDK/provider calls.

| Editor export | Complete IDs | Blocker / hard limit | Verdict | Final check |
|---|---|---|---|---|
| Current official fixed | C1,C2,C3,C4,C5 | C3 / C3 | DO_NOT_SIGN | **PASS** |
| Pinned repo original | C1,C4 | none | CLEAN | **FAIL** |

The terminal Collate runs once. Its independent final Manual Trigger check reads output 0/run 0 after the completed loop: original execution indices **11 → 12**; official fixed **20 → 21**.

**Author's separate record:** Adrian Hunia's [SEVENEDGE write-up](https://sevenedge.pl/en/workflows/przeglad-umow-playbook-ai), verified **2026-11-05**, reports their own n8n **2.8.4** five-clause test: batch 3 → C1,C4/CLEAN; one clause per pass → five clauses/DO_NOT_SIGN.

The pack also retains historical CLI controls: original observation exit 0, remove-batchSize/default-1 control exit 0, and original/broken with the same release expectation exit 1. All three native workflows themselves succeeded. The remove-parameter control is distinct from the actual official fixed source; full recorded items and JSON/JUnit checks are included.

## Repeat this release check

Keep the synthetic input and complete expected findings unchanged. For a candidate release, transplant its four local Config/Batch/Store/Collate nodes into the fixture test, preserving their names and loop connections, then execute. A lost clause or changed complete result makes the check red.

For an installed [n8n-check CLI](https://www.npmjs.com/package/@blucca/n8n-check) **0.1.9** and an installed n8n runtime (Node 24+ for the CLI route), extract the pack and run serially:

```sh
n8n-check original.workflow.json original-control.case.json \
  --n8n /path/to/n8n --allow-network --out results/original-control

n8n-check fixed.workflow.json fixed.case.json \
  --n8n /path/to/n8n --allow-network --out results/current-fixed

n8n-check broken.workflow.json broken.case.json \
  --n8n /path/to/n8n --allow-network --out results/broken-release
# The broken release check exits 1: expected C1–C5/C3/DO_NOT_SIGN, actual C1,C4/CLEAN.
```

`fixed.case.json` and `broken.case.json` are byte-identical. The separate original observation control records the old behavior. `default-one-control.*` keeps the historical remove-parameter control. Every release expectation preserves the same complete five-clause contract.

## Source and licence

- [Original source](source/repo-original.workflow.json): `sevenedge-pl/n8n-workflows`, commit **ef565f8473d427b8144f719e7267742b0dc58909**, `workflows/multi-agent-patterns/contract-review-playbook/workflow.json`.
- [Actual official fixed source](source/official-current.workflow.json): ordinary public [n8n template 18748 API](https://api.n8n.io/api/templates/workflows/18748), acquired **2026-11-15**. Exact origins/hashes are in [provenance.json](provenance.json); [source-integrity.json](source-integrity.json) records source/config/Code equality, and [differences.json](differences.json) lists the fixture boundaries.
- SEVENEDGE code and repository documentation: **MIT, Copyright (c) 2026 SEVENEDGE**. Complete notice in [LICENSE](LICENSE) and `source/LICENSE`; keep it with copied exports.

This is an independent publication-regression case for the inspected JSON loop. The complete source exports are included for inspection.
