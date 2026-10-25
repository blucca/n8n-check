# Green JSON snapshots. Wrong customers.

A real n8n parent/child regression: **every business-node JSON snapshot stays
identical, both workflows succeed, and two HTTP requests go to the wrong customers.**
This lab reproduces the fault, reduces its input, and verifies a process-local
repair of the shared ancestry traversal.

Related upstream investigation: [n8n #35559](https://github.com/n8n-io/n8n/issues/35559).
This lab adds a saved-execution, wrong-recipient regression to that existing report.

## Observed result

Four synthetic customers A–D have the same product and quantity. The child has
two branches: first two orders, or descending sequence followed by the first two.
Both branches project away customer identity before a Merge selects its input.
The parent uses `$('Orders').item` to address the outgoing request.

| Child branch | Intended recipients | Original runtime | Repaired traversal |
|---|---|---|---|
| First two | A, B | A, B | A, B |
| Latest two | D, C | **A, B** | **D, C** |

The local receiver returns `{"ok":true}` for every request. All **11 business
nodes** retain identical JSON across the branch change, including every recorded
run/output/item. Only the inbound Webhook transport envelope is excluded from
the snapshot comparison. Raw execution metadata and actual HTTP bodies are
recorded separately.

The test binds each request to `$itemIndex`. HTTP arrival order varies because
the HTTP Request node executes items concurrently. The failure predicate also
requires a recipient outside the intended set, so a harmless change of arrival
order cannot satisfy it.

**Tested stack:** n8n 2.41.7, n8n-core 2.41.5, n8n-nodes-base 2.41.5,
n8n-workflow 2.41.2, Node 26.12.0. The result applies to this recorded stack.
[Measured results](observed-results.json) distinguish original, repaired and
extended checks. This is an experimental overlay, with the installed runtime
left unchanged.

## The boundary error

The original `findPairedItemThroughWorkflowData()` follows `task.source[0]`
regardless of the paired item's input. It also uses that input index as the
previous node's output index. A Merge input is an edge into the consumer;
the producer's output and run are specified by that edge's
`previousNodeOutput` and `previousNodeRun`.

When traversal fails, Execute Workflow retains the child's last local pairing.
Here `{item:0}` and `{item:1}` become valid-looking but wrong parent references.

[`backtracking.cjs`](backtracking.cjs) walks the actual input edge, resolves its
producer output/run, and continues to the child trigger's external input index.
It preserves a set of ancestors for legal fan-in. Missing provenance retains
the existing helper's `undefined` return contract. Broader workflow families
remain outside this experiment's coverage.

[`overlay.cjs`](overlay.cjs) replaces this shared helper only in the disposable
n8n process. It does not edit the installed package or a production instance.

## Inspect your own saved child call

**Two execution JSON files and Node.js. No n8n startup, uploads or package install.**

Export the complete parent and child responses from
`GET /api/v1/executions/<id>?includeData=true`. Use the child execution ID from
the parent's actual `metadata.subExecution` entry. Then run:

```sh
node experiments/lineage-boundary/audit-executions.cjs \
  parent-execution.json child-execution.json > ancestry-report.json
```

The report identifies the caller node/run and its input's source node/run/output.
For each returned item, it compares reconstructed child ancestors with the
pairing actually recorded on the parent. For the failing example:

| Caller output item | Expected input item | Recorded input item |
|---|---|---|
| 0 | 3 (customer D) | 0 (customer A) |
| 1 | 2 (customer C) | 1 (customer B) |

The emitted report contains indices and node/execution identifiers, without
copying customer JSON. Exit **0** means the inspected boundary's ancestry is
consistent; **1** reports a mismatch; **2** reports incomplete or unsupported
evidence, with a reason. HTTP recipient, payload and other business expectations
remain separate acceptance contracts.

This first auditor covers a successful, waiting **once-mode Execute Workflow
1.2** call with one passthrough child trigger and complete saved provenance.
Both directions of the recorded call edge must match. The child trigger must
preserve the caller's input order and JSON, and the recorded terminal outputs
must match the caller's output shape and JSON. Per-item calls, missing execution
history, transformed trigger inputs and boundary `sourceOverwrite` need a
separate contract and return exit 2.

The auditor reuses the experimental traversal above. It is checked against the
already-recorded native original/repaired runs, including legal many-to-one:

```sh
node experiments/lineage-boundary/check-audit.cjs \
  "$LAB/original" "$LAB/repaired"
```

## Reproduce

Python's standard library and an installed n8n runtime are sufficient. Use a
scratch directory outside the repository for runtime dependencies and results:

```sh
export LAB="$WORKSPACE/temp/n8n-lineage"
mkdir -p "$LAB"
npm_config_cache="$LAB/npm-cache" npm install --prefix "$LAB/runtime" n8n@2.41.7

python3 -B experiments/lineage-boundary/run.py \
  --runtime "$LAB/runtime" --output "$LAB/original" --extended

python3 -B experiments/lineage-boundary/run.py \
  --runtime "$LAB/runtime" --output "$LAB/repaired" --extended \
  --overlay experiments/lineage-boundary/overlay.cjs
```

Run from the n8n-check checkout. Each output path must be new. The script starts
one loopback n8n server and one loopback recipient, creates a fresh SQLite
database and temporary test account, and removes that database when finished.
The output retains workflows, inputs, complete persisted parent/child executions,
actual call edges, HTTP requests, activation receipts and a result summary.
Child execution IDs come from the parent's real `subExecution` edge.

The original run completes with `counterexample_found: true`. The repaired run
requires every extended identity check to pass. A 512 MiB V8 heap is configured;
the observed process peak and CPU use include startup and cleanup.

Activation on this stack occasionally returns before webhook visibility.
Only explicit pre-execution “not registered” HTTP 404 responses receive a
bounded retry. Executed requests and other failures are recorded without retry.

## Reduction and scope

The bounded reducer removes trailing input records and executes both branches
again. **Four → three records preserves identical JSON and the wrong-recipient
failure. Three → two loses the wrong-recipient-set predicate.** This is an input
reduction for the fixed two-item selection rule, not a claim of a globally
minimal workflow graph.

Additional checks use changed IDs and non-monotonic sequence values, plus a
legal many-to-one Merge whose returned item must retain all four ancestors.
The small standalone traversal check also exercises producer output 1 and
producer run 1 using the real branch receipts:

```sh
node experiments/lineage-boundary/check-backtracking.cjs \
  "$LAB/original/input1-child-execution.json" \
  "$LAB/original/input2-child-execution.json"
```

All customer data is synthetic. The lab uses a self-authored graph inspired by
public item-linking reports; customer-specific workflows and their acceptance
criteria remain separate.
