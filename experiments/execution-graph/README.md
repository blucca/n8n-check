# Follow the customer from child call to HTTP

**The saved execution graph passes. The saved recipient is correct. The HTTP
request still reaches the wrong customer.** A native control changes only the
HTTP expression to `Customers.first()`: all 11 business-node JSON snapshots
match, all four executions succeed, and three of four requests are misdirected.

This local release check separates **composed ancestry**, **saved customer
relationships**, and **independently observed HTTP effects**. Plain Node.js,
complete saved exports, an explicit business contract and receiver records;
customer data stays on the operator's machine.

[**Inspect saved calls in your browser**](https://blucca.github.io/n8n-check/inspect/) — select your complete parent + all child API responses and download the same recorded-ancestry report, with no installation. The browser and Node >=24 CLI share [`core.mjs`](../../web/saved-calls/core.mjs). Customer-relationship and independently observed HTTP checks retain the separate contracts below.

[Run the HTTP counterexample](#correct-saved-recipient-wrong-http-request) ·
[Check your own task](#bind-your-own-http-records-to-the-saved-task) ·
[$650 identity audit and repair](#one-customer-route-650-audit-and-repair)

[**Source-built runtime repair:**](../runtime-return-repair/) follow the actual terminal run, preserve all-runs links, and restore the right HTTP customer even with child success saving disabled.

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

Get the published research branch, then run from its repository root:

```sh
git clone --depth 1 --single-branch --branch research/execution-graph-20261105 \
  https://github.com/blucca/n8n-check.git n8n-customer-check
cd n8n-customer-check
```

This checkout includes the complete native records and all three local checkers.
The default branch retains the earlier boundary auditor. Set `WORKSPACE="$PWD"`
for local capture outputs, or point it at your existing workspace.

**Node.js >=24, three JSON files. Local read-only execution.**

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

## Collect a complete saved bundle in one command

Set `N8N_API_KEY` in your local environment for the existing instance, then:

```sh
export LAB="$PWD/temp/saved-call-new"
node experiments/execution-graph/fetch-bundle.cjs \
  https://your-n8n.example 123 "$LAB" &&
node experiments/execution-graph/audit-bundle.cjs "$LAB"/execution-*.json
```

For a standalone collector and browser report, [download the single script and follow the local command](https://blucca.github.io/n8n-check/inspect/#get-files). It needs Node.js 24+ and your local API key; a repository checkout is optional for that path. Select the resulting `execution-*.json` files in the inspector. An optionally selected `manifest.json` is kept separate as an acquisition receipt.

Use a fresh output directory. The GET-only collector follows the actual
once-task and each-item child IDs recursively, requesting `includeData=true`.
It preserves each response body verbatim and writes a complete acquisition
manifest after collecting all referenced executions. A failed GET returns
`incomplete`/exit 2 and leaves the partial local records for diagnosis. The
reporter performs the separate ancestry audit.

Check the acquisition contract with the included native-record API replay:

```sh
node experiments/execution-graph/check-intake.cjs \
  "$PWD/temp/intake-check-new"
# four GETs, exact saved bytes/IDs, consistent/9; missing child incomplete
```

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

## Correct ancestors, wrong customer relationship

A second native family uses four orders and four customers in two tenants.
Both tenants have customers `c1` and `c2`. Standard Aggregate nodes preserve both
complete role tables; Merge combines their envelopes; Split Out selects orders;
Set prepares `{slot, subjectId, recipient}`; a waiting passthrough child returns
those effects; HTTP Request sends them to an independent loopback receiver.

```text
Orders    → Aggregate orders    ┐
                               Merge → Split orders → Set recipient → Call Delivery → HTTP
Customers → Aggregate customers ┘                       full / single key    ↓
                                                                        Start → Return
```

| Set lookup rule | Saved ancestry | HTTP recipient errors | Relationship contract |
|---|---|---|---|
| `(tenantId, customerId)` | consistent, all 8 source records | 0 / 4 | consistent |
| `customerId` first match | consistent, all 8 source records | **2 / 4** | **mismatch, slots 2/3** |

All four executions succeed on the unmodified official **n8n 2.43.0** runtime.
The single-key workflow deliberately uses the first matching ID: the two blue
tenant orders reach the amber customers. Their `subjectId` and request slots
remain correct. The independent Python input oracle fixes the allowed composite
relationships before workflow creation; the receiver records actual HTTP.

A strong complete-key join baseline finds the same two recipient errors.
The saved-data checker adds explicit order/customer source roles, complete
ancestor sets, the matching customer coordinate, and a portable local contract.
The earlier nested experiment measures a runtime ancestry fault; this family
measures a workflow's business-key policy.

```sh
node experiments/execution-graph/relation-contract.cjs \
  experiments/execution-graph/recorded/relations/single-key-contract.json \
  experiments/execution-graph/recorded/relations/single-key-parent-execution.json \
  experiments/execution-graph/recorded/relations/single-key-child-execution.json
# mismatch, exit 1; RECIPIENT_MISMATCH at slots 2/3

node experiments/execution-graph/check-relations.cjs
# PASS: native HTTP/oracle, complete-key baseline, all 8 ancestors and witnesses
```

Replace `single-key` with `full-key` for **consistent / exit 0**.
The default report emits coordinates and fixed reason codes, retaining input
payloads locally. An effect with valid recipients also requires evidence of its
subject order and allowed customer in the declared ancestor set. Missing child
records or duplicate complete customer keys produce **incomplete / exit 2**.

### Apply the relationship contract to your own saved task

Use the collector above, then copy one included contract and set your saved
execution IDs and source/target node coordinates. Version 1 reads these fixed
fields:

- `Orders` role: `order.id`, `order.tenantId`, `order.customerId`.
- `Customers` role: `customer.tenantId`, `customer.id`, `customer.email`.
- Effect record: `slot`, `subjectId`, `recipient`.

Each role explicitly selects an execution, node, run and output. `record_path`
selects its `order` or `customer` object; every item in that output is included
in the role table and source cut. Keys are nonempty strings. `order.id` is unique
within the declared table; customer `(tenantId,id)` has cardinality one.

`subjectId` declares the acted-on order. The contract checks that declared
order's allowed customer and saved recipient, with both source witnesses.
Intended effect count, slot schedule and the truth of the subject declaration
come from the operator's separate acceptance rules. This capture independently
checks all four HTTP subject/slot pairs against its pre-execution oracle.

For a first fit check, run the two commands locally on **one of your own complete
successful waiting-child executions** and [send its status/reason, n8n version,
node count and expected relationship](mailto:belgialucca@gmail.com?subject=Execution%20Graph%20local%20fit%20check).
Keep raw records and API credentials on your machine. A concrete repeatable
mismatch gives the next repair scope.

[Two native bundles, contracts and HTTP observations](recorded/relations/)
and [measurements](relation-results.json) accompany the checker. Recreate the
family with the cached official image and the same bounded resource policy:

```sh
python3 -B experiments/execution-graph/run-relations.py \
  --output "$WORKSPACE/temp/n8n-relations-new" --wall-limit 300
```

The native run used 15.28 CPU seconds, a 611.62 MiB memory peak and 15.05 seconds
wall time; its dedicated runtime and database were released afterwards.

## Correct saved recipient, wrong HTTP request

The four-order/two-tenant control now keeps the **full-key Set lookup correct
in both workflows**. Only the HTTP body expression changes:

```js
// Control: send the recipient carried by the correctly joined order.
$json

// Fault: preserve the order and slot, take the first customer's email.
({slot: $json.slot, subjectId: $json.subjectId,
  recipient: $('Customers').first().json.customer.email})
```

| HTTP expression | Composed ancestry | Saved relationship | Actual recipient errors | Effect contract |
|---|---|---|---|---|
| `$json` | consistent / 4 | consistent / 4 | 0 / 4 | consistent |
| `Customers.first()` | consistent / 4 | consistent / 4 | **3 / 4** | **mismatch, slots 1/2/3** |

All **11 business-node JSON snapshots**, at every run/output/item position,
match between the cases. Each effect has all eight legitimate order/customer
ancestors. The HTTP node saves the same `{ok:true}` responses, while the
independent receiver observes the differing outbound bodies. These are actual
requests from unmodified official **n8n 2.43.0**, with successful parent/child
executions in each case. This fault belongs to the workflow's HTTP expression.

The receiver records execution ID, node, run, output and item from request
headers. The checker verifies complete unique target coverage, follows each
saved `Deliver` output to its unique `Call Delivery` item, and checks the
observed subject, slot and recipient against that item's authorized customer.
It returns three separate reports: `source_ancestry`, `saved_relationship`,
`actual_effects`. Reports contain coordinates and fixed findings; raw bodies
stay in the local input files.

```sh
node experiments/execution-graph/effect-contract.cjs \
  experiments/execution-graph/recorded/effects/http-first-contract.json \
  experiments/execution-graph/recorded/effects/http-first-http-observations.json \
  experiments/execution-graph/recorded/effects/http-first-parent-execution.json \
  experiments/execution-graph/recorded/effects/http-first-child-execution.json
# mismatch / exit 1: only actual_effects has three recipient mismatches

node experiments/execution-graph/check-effects.cjs
# PASS: native oracle/HTTP, same 11 JSON snapshots, complete-key baselines,
# coordinate coverage and exact caller/customer witnesses
```

Replace `http-first` with `saved-json` for **consistent / exit 0**.
A strong complete-key join baseline agrees: saved payloads have zero recipient
errors in both cases; actual HTTP bodies have zero/three. The method adds an
explicit binding between a received request, its saved task, the declared order
and the customer-source coordinate. Synthetic missing/duplicate/foreign
coordinates are tested separately from the native HTTP-expression fault.

[Two complete fictional bundles, observer rows and contracts](recorded/effects/)
and [measurements](effect-results.json) are included. Recreate this family:

```sh
python3 -B experiments/execution-graph/run-relations.py \
  --output "$WORKSPACE/temp/n8n-http-effects-new" --http-first-control --wall-limit 300
```

The capture used **10.82 native CPU seconds**, a **726.23 MiB memory peak** and
**17.08 seconds wall time**. Its dedicated container and SQLite database were
released after collection; existing services were preserved.

## Bind your own HTTP records to the saved task

First [collect one complete saved bundle](#collect-a-complete-saved-bundle-in-one-command)
and [declare your source roles and saved effects](#apply-the-relationship-contract-to-your-own-saved-task).
Add the exact HTTP response-output block to the same contract:

```json
"observed_effects": {"execution": "123", "node": "Deliver", "run": 0, "output": 0}
```

Supply independently captured receiver or gateway records in a local JSON
array. Each row contains the **actually received body** and its saved coordinate:

```json
[{"coordinate": {"execution": "123", "node": "Deliver", "run": 0, "output": 0, "item": 0},
  "body": {"slot": 0, "subjectId": "order-a", "recipient": "customer-a@example.test"}}]
```

The included native collector uses these HTTP headers:
`X-Audit-Execution = {{ String($execution.id) }}`,
`X-Audit-Run = {{ String($runIndex) }}`,
`X-Audit-Item = {{ String($itemIndex) }}`; node name and output `0` are explicit
workflow constants. Existing request IDs/gateway logs can supply the same
mapping when their execution/run/item association is established locally.
Arrival order is irrelevant. The body comes from the receiver record.

**v1 contract:** one outbound request per saved HTTP response item in the
declared output block, and a one-to-one binding to the declared caller effect
block. The source contract has unique order IDs and unique full customer keys.
Complete successful waiting-child exports and all target observer rows are
required. Response splitting, retries with multiple requests per item, detached
calls and transformed trigger schemas need a separately agreed capture contract.
Missing observations, duplicate coordinates and out-of-target execution IDs
produce `incomplete` / exit 2 with a fixed reason code.

```sh
node experiments/execution-graph/effect-contract.cjs \
  "$WORKSPACE/temp/customer-contract.json" "$WORKSPACE/temp/receiver-records.json" \
  "$LAB"/execution-*.json
```

For a first fit check, [send the n8n version, three layer statuses/reasons,
expected relationship and target date](mailto:belgialucca@gmail.com?subject=n8n%20HTTP%20identity%20fit%20check).
Keep raw records and credentials local. A concrete task and its acceptance
rules set the repair scope.

## One customer route: $650 audit and repair

For an agency or team releasing a multi-customer workflow: **$650 fixed scope**
for one agreed customer/order route, up to **3 workflows / 30 standard nodes /
2 documented systems / 5 agreed checks**, a focused fix, before/after source and
HTTP evidence, a reproducible local handoff, and one in-scope revision.

First delivery within **three business days** after scope, materials and the
**$325 start payment** are agreed; the remaining **$325** is due when the agreed
checks pass. Blucca's human account owner handles the agreement and payment;
Codex delivers the engineering asynchronously. Start by sending the **version,
workflow count, observed wrong result and target date**. The short local fit check
sets the supported capture and exact acceptance rules before paid work starts.
The existing [$199 single-fault slice](../../#paid-help-for-one-failing-workflow)
retains its smaller one-workflow/mocked-system scope.

## Reproduce the native nested capture

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
