# Batch-size sensitivity in n8n JSON transforms

For a deterministic, independent-record transformation, sending two records
together should produce the same output rows as processing them separately.
This experiment applies that relation to the **actual n8n engine** and reports
the first observed differing node in a linear slice. It uses input records and
a declared business relation, without a hand-written expected-output table.

```text
F(A ⊎ B) = F(A) ⊎ F(B)
```

Outputs are compared as **multisets**: repeated rows retain their multiplicity.
Object key order is ignored; arrays inside a row retain their order. The
identity-filter controls explicitly select `id` and `score`, leaving their
time-dependent `processedAt` outside this comparison.

## Recorded native results

Official n8n **2.46.6**, Node **24.21.0**, Linux x86-64. Ten predeclared controls,
36 successful CLI executions; provider calls and workflow HTTP requests: zero.
[Full measured report](observed-results.json) · [Frozen inputs and sources](controls.json) ·
[Source manifest](source-manifest.json).

| Control | Batch rows | Singleton union | Observed classification |
| --- | ---: | ---: | --- |
| Correct invoice mapping | 2 | 2 | `partition_consistent` |
| First-record truncation | 1 | 2 | `partition_sensitive` |
| Same-count first-ID contamination | 2 | 2 | `partition_sensitive` |
| Valid duplicate records | 3 | 3 | `partition_consistent` |
| Per-record filter, id/score projection | 2 | 2 | `partition_consistent` |
| Uniform wrong-ID blind spot | 2 | 2 | `partition_consistent` |
| Valid empty filter output | 0 | 0 | `partition_consistent` |
| Uniform obsolete-filter blind spot | 0 | 0 | `partition_consistent` |
| Declared whole-batch summary | 1 | 2 | `scope_required` |
| Declared shared sequence state | 3 | 3 | `scope_required` |

Both partition-sensitive invoice controls yield a **two-record witness** at
`Prepare notification`: one loses a row; the other preserves output count while
borrowing the first invoice's ID. Their actual rows and multiplicities appear
in the report. This is the first differing output in the recorded linear
execution order, on main output 0.

## Business semantics choose the relation

The applicable contract is a stateless, deterministic JSON slice whose records
are independent, under the same initial state and configuration. Per-record
filters and fan-out fit this contract; their output volume can vary.

- A whole-batch summary legitimately combines records.
- A sequence allocator legitimately shares state across records. The control
  uses in-execution `staticData`; each prepared workflow starts empty.
- Both receive `scope_required` from their **predeclared semantic contracts**.
  Their observed relation differences remain in the report.

The constant wrong-ID and obsolete-filter controls demonstrate the central
blind spot: a transformation can make the same business mistake in every
partition and remain `partition_consistent`. Business expectations determine
correct values and allowed deletions.

This observer reports JSON relationships at the selected boundary. Input
ancestry uses the existing [saved-call inspector](https://blucca.github.io/n8n-check/inspect/); actual
HTTP delivery and stateful integrations use their own execution evidence.
Output-row order, persistent history and general branching graphs are outside
this recorded experiment. The relation is established metamorphic testing;
this artifact supplies its concrete n8n execution, observations and witnesses.

## Reproduce

Use a checkout of this research branch, Node 24+ and an installed official
`n8n@2.46.6` runtime. From the repository root:

```sh
node experiments/batch-partition/check-compare.mjs
N8N_BINARY=/absolute/path/to/node_modules/.bin/n8n
node experiments/batch-partition/run-native.mjs temp/batch-partition "$N8N_BINARY"
```

The observer reuses the repository's slice preparation and CLI process control.
It creates a fresh local SQLite home, replaces the input boundary with frozen
JSON and cuts outgoing connections at the selected output. Production
credentials and pins remain in the source export. Each workflow runs with the
same empty initial state, once with the full input and once per input record.

Existing slice preparation uses a `count: 0` schema placeholder. The observer
judges engine success and the measured batch/singleton relation; the placeholder
is used solely for preparation. Control labels check observer classifications.
The seven small comparator assertions cover multiplicity, object/array order,
explicit projection, missing fields and empty output.

Run artifacts are written under `temp/batch-partition/native/`: complete raw
executions, process responses, prepared exports, progress and `results.json`.
The engine has a 512 MiB Node heap setting and each CLI command a 60-second
timeout. File contents and Code nodes in this frozen corpus are synthetic.

## Research outcome

The scientific gate passed: the measured observer separates the two local
batch faults, legitimate independent transforms and declared cross-record
semantics, while preserving the two uniform-error counterexamples. The public
product, CLI version and builder remain unchanged. A native single-file editor
bridge is a separate delivery to select against an operator's real task.

AI-led research by Codex / Blucca. MIT, alongside the repository license.
