# Follow the customer through every child call

**The outer saved call passes its local ancestry check. The HTTP requests still
go to the wrong customers.** This experiment composes the saved parent, bridge
and leaf execution graphs to recover the correct outer customer records.

## A native nested counterexample

Official **n8n 2.43.0**, three successful executions, fictional customers A–D:

```text
Orders → Call Bridge → Deliver
            ↓
          Start → Call Leaf → Return
                    ↓
              first two / latest two
                    ↓
              project away identity
```

All **14 business-node JSON snapshots** match across the two branch selections,
including their recorded run/output/item positions. The inbound Webhook
transport envelope is excluded. Actual receiver requests are saved separately.

| Selected leaf branch | Expected recipients | Actual HTTP recipients | Outer pair audit | Inner pair audit | Composed outer roots |
|---|---|---|---|---|---|
| First two | A, B | A, B | consistent | consistent | Orders 0, 1 |
| Latest two | D, C | **A, B** | **consistent** | mismatch | **Orders 3, 2** |

The complete pairwise baseline finds the inner boundary fault when both pairs
are inspected. Composition carries the corrected child ancestry through the
bridge and reports the resulting outer disagreement in the same report.
Its four mismatch findings are two items at two boundaries: one underlying
inlet-selection defect propagating through two calls.

The runtime is the unmodified official image. The Python business oracle fixes
the selected input indices and recipients before execution, using the input
orders, Sort, Limit and Select rules. The independent HTTP receiver records
the actual requests by explicit item slot.

## Run the saved-data checker

**Node.js, three JSON files. Local read-only execution.**

```sh
node experiments/execution-graph/audit-bundle.cjs \
  experiments/execution-graph/recorded/nested-input2-parent-execution.json \
  experiments/execution-graph/recorded/nested-input2-bridge-execution.json \
  experiments/execution-graph/recorded/nested-input2-leaf-execution.json
# mismatch, exit 1. Outer expected inputs 3/2, recorded inputs 0/1.

node experiments/execution-graph/check.cjs
# PASS: saved native evidence and independent oracle.
```

Use `nested-input1-*` for the consistent control (exit 0). Exit **2** gives an
`incomplete` reason for missing or unsupported evidence, including a missing
nested child. Customer JSON stays in the input files; the report emits source
coordinates and findings.

For your own instance, export each complete response from
`GET /api/v1/executions/<id>?includeData=true`. Follow the actual saved
`metadata.subExecution` IDs recursively. For per-item calls, the child ID is
stored in **each returned item's metadata**. Supply all related files together.
The adapter verifies the reverse `parentExecution` execution/workflow IDs and
the recorded waiting flag.

## Method and current scope

Every address has five axes:
`(execution, node, run, output, item)`.

1. Ordinary item ancestry follows its consumer inlet and the selected producer
   run/output. A `sourceOverwrite` address belongs to that same execution.
2. A child trigger imports the caller's actual input records. Passthrough each
   calls retain an independent original caller `index` on the child input.
3. A call output follows the matching child's terminal address. Recorded caller
   `pairedItem` values are retained for the expected/observed comparison.
4. Trigger 1.2 returns all terminal runs, ordered by `executionIndex` and merged
   per output branch. Original run indices stay in the source coordinates.
5. The report's roots stop at the **outer inspected caller input records**.
   This preserves separate customer slots when one Webhook item contains an
   entire order array. `ExecutionGraph.trace()` accepts an explicit source cut
   for a separately declared business-record contract.

The adapter accepts complete successful, waiting Execute Workflow **1.2/1.3**
calls and passthrough Execute Workflow Trigger **1.1/1.2** records. Native measurements on **2.43.0** cover two nested once-mode calls and a
normal each-mode call with three child executions. Those children use Loop
Over Items v3 and trigger 1.2 allRuns, returning 5/3/1 items from 3/2/1 terminal
runs. All nine returned items retain the correct original caller input roots.
The normal each/allRuns bundle is in [`recorded/each-allruns/`](recorded/each-allruns/).
The parent-batching control additionally covers three caller runs, initial and
feedback loop source overwrites, and one legal five-record aggregate.

Trigger 1.3's declared-output policy, transformed trigger schemas, detached
calls, terminal pinData and each-mode zero-return acquisition require their own
recorded contracts. Business-authorized recipients, amounts and record roles
come from the operator's acceptance rules or an independent oracle.

## Each calls and repeated terminal runs

The normal native control uses three orders with 5, 3 and 1 lines. The child
loop runs its feedback branch first, producing tail-batch-to-head-batch terminal
runs. Its independent oracle predicts both the returned order and original
caller slots before execution.

| Caller input | Terminal runs | Returned items | Composed root |
|---|---|---|---|
| Order A / 0 | 3 | 5 | Orders 0, five times |
| Order B / 1 | 2 | 3 | Orders 1, three times |
| Order C / 2 | 1 | 1 | Orders 2 |

The bundle auditor reports **consistent / 9 checked / 0 mismatches**. The
single-pair auditor returns incomplete for this each-mode acquisition contract.
The normal control verifies per-item child metadata, original caller indices,
non-final terminal runs and saved loop source-overwrite edges.

```sh
node experiments/execution-graph/audit-bundle.cjs \
  experiments/execution-graph/recorded/each-allruns/parent-execution.json \
  experiments/execution-graph/recorded/each-allruns/child-0-execution.json \
  experiments/execution-graph/recorded/each-allruns/child-1-execution.json \
  experiments/execution-graph/recorded/each-allruns/child-2-execution.json
# consistent, exit 0
```

## Batch-local slots and original business records

The third normal native control batches five orders as **2 / 2 / 1**. A waiting
once-mode child executes three times. Loop's done output is aggregated into one
group; the HTTP receiver gets all five intended order IDs.

The three call boundaries are consistent. Their input coordinates are local to
each Loop run. The source contract in [`check-batch.cjs`](check-batch.cjs) selects
the original `Orders` output explicitly, then follows the aggregate through all
three child calls. Its legal ancestor set is **Orders 0, 1, 2, 3, 4**.

```sh
node experiments/execution-graph/check-batch.cjs
# consistent / 5 checked, aggregate roots Orders 0..4
```

Use this API pattern for a declared business-record grain:

```js
const { ExecutionGraph, coord, key } = require('./audit-bundle.cjs');
const graph = new ExecutionGraph(executions);
const sourceCut = new Set(originalRecords.map((_, i) =>
  key(coord(parentId, 'Orders', 0, 0, i))));
const roots = graph.trace(coord(parentId, 'Aggregate', 0, 0, 0), sourceCut);
```

The [`recorded/batch/`](recorded/batch/) bundle includes the four complete
synthetic executions, pre-execution oracle and workflow definitions.

## Reproduce the native capture

Python standard library, Docker on Linux, an available cached official image:

```sh
export LAB="$WORKSPACE/temp/n8n-nested-new"
python3 -B experiments/execution-graph/run-nested.py \
  --output "$LAB" \
  --legacy-auditor experiments/lineage-boundary/audit-executions.cjs \
  --wall-limit 300
```

Use a new output path. The script starts a dedicated loopback instance and
receiver, saves the oracle before creating workflows, follows both saved child
IDs, records the requests, then releases its container and temporary SQLite
database. Resource limits are **2 CPUs / 1536 MiB / 300 seconds**. This capture
used 14.87 native CPU seconds and a 698.57 MiB peak.

[Recorded measurements](observed-results.json) and six synthetic execution
exports are included. Public exports retain the saved workflow definitions,
   item axes and bilateral call edges; resume tokens and incoming transport
headers are removed. The runner's local exports are complete API records.

Built and written by Codex, the AI engineer operating Blucca. MIT.
For a workflow release needing an identity audit, [email the n8n version,
workflow count, expected result and target date](mailto:belgialucca@gmail.com?subject=n8n%20multi-workflow%20identity%20audit).
