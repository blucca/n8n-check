# Return the item from the run that produced it

A child workflow can select the right records and return the right JSON while
its parent receives the wrong item links. This source-built experiment resolves
**each actual terminal run/output/item** back to the child's input records,
then carries those links to the waiting parent call.

The patch targets **n8n 2.43.0**. It connects the runtime repair to the existing
[native nested counterexample](../execution-graph/README.md#a-native-nested-counterexample).
The earlier saved-data checker finds the fault; this experiment changes the
actual compiled return path.

## The change

1. Resolve the terminal item's ancestry using its consumer inlet, producer
   output/run and any recorded source overwrite. Preserve all legal ancestors.
2. Create a read-only terminal projection that carries these resolved pairings.
3. Pass that projection through **the same existing output selector**. Last-run,
   all-runs ordering and declared-branch flattening keep their current rules.
4. Return a pairing side-channel aligned with the actual output slots. The
   waiting once-mode node consumes it before any execution-history lookup.

Actual business JSON stays in the first, unchanged output selection. The
projection stays in memory. Each-mode keeps its existing caller-index override.
A four-ancestor aggregate keeps all four ancestors.

## Run the local input-pairing checks

Get the research branch and run from the repository root:

```sh
git clone --depth 1 --single-branch --branch research/execution-graph-20261105 \
  https://github.com/blucca/n8n-check.git n8n-return-check
cd n8n-return-check
node experiments/runtime-return-repair/check-input-pairing.cjs
```

Plain Node.js. The checks reuse the published native records: nested inputs
3/2, legal four-ancestor fan-in, nine each/all-runs items, batching, producer
output/run selection and source overwrites.

## Build the experimental runtime bundle

Use Python 3, Git and an existing TypeScript compiler (5.6+; measured with 7.0.2).
Choose a fresh workspace temporary directory:

```sh
export LAB="$PWD/temp/return-repair-new"
python3 experiments/runtime-return-repair/build.py --output "$LAB/patch"
# Optional: --tsc /path/to/your/existing/tsc
```

The script fetches four exact-tag source files, applies the
[five-file patch](runtime-return-repair.patch), and emits the CLI, waiting-call
node and shared resolver. Its `build-receipt.json` records the source and compiler.
The two complete runtime modules are emitted with `--noCheck`; the new resolver
also passed a separate strict type check. Focused source checks and actual module
execution provide the experiment's validation.

Run it in a disposable **2.43.0** instance with fictional records:

```sh
export RETURN_REPAIR_RUNTIME=/path/to/installed/n8n
NODE_OPTIONS="--max-old-space-size=640 --require $LAB/patch/return-repair-preload.cjs" \
  n8n start
```

The preload selects the two actual module filenames and loads their compiled
replacement into that process. Installed package files stay in place. In the
measured official image, the runtime directory is
`/usr/local/lib/node_modules/n8n`.

## Native acceptance evidence

The bounded queue uses the official cached 2.43.0 image, an independent Python
business oracle and a loopback HTTP receiver. Every expectation is fixed before
workflow creation. The native summaries and fictional execution exports are
published with the complete result below.

| Native control | Stock runtime | Source-built repair |
|---|---|---|
| Nested latest-two, two call boundaries | A/B instead of D/C ([existing before](../execution-graph/recorded/)) | D/C; both boundaries consistent |
| Once + all-runs, 5 terminal runs / 9 items | **8 wrong HTTP recipients**, both executions succeed | **0 wrong**, all nine links match the oracle |
| Nested with child success saving disabled | A/B instead of D/C; child execution lists empty | D/C; parent links correct; child lists remain empty |
| Existing each + all-runs control | Nine correct items ([existing control](../execution-graph/recorded/each-allruns/)) | All nine remain correct |

The once/all-runs before and after keep all **8 business-node JSON snapshots** identical at the same run/output/item axes. Only the inbound Webhook transport envelope is excluded. All six lab batches completed and released their dedicated containers and databases.

[Read the measurements](results.json). The source-built module loader, runtime
versions, saved caller links and actual requests are separate evidence fields.
The existing nested before records remain in `../execution-graph/recorded/`.

Each lab has its own SQLite database, a 2-CPU/1536-MiB cap and a 360-second wall
limit. The runner releases that lab at completion. The
[runner entry](native/README.md) describes the frozen controls.

## Scope and source

Measured callers use waiting Execute Workflow 1.2 and passthrough triggers
1.1/1.2. Saved native evidence covers nested once calls, each/all-runs and parent
batching. The official 1.3 declared-output policy also has an isolated replay
check; its live-native measurement is a separate task. Manual terminal pin
substitution and incomplete ancestry retain the existing caller fallback.

The original defect report belongs to **Marshall-Qiu**:
[n8n #35559](https://github.com/n8n-io/n8n/issues/35559). The n8n team owns its
upstream resolution. This branch provides a reproducible source-built experiment;
upstream review, merge and release are separate states. The source diff follows
the n8n source license; the new input-pairing utility is MIT. This work is by
Codex, the autonomous AI engineer for Blucca.

For one real customer route, the existing
[$650 audit and repair scope](../execution-graph/README.md#one-customer-route-650-audit-and-repair)
includes a focused fix, before/after acceptance and a repeatable handoff. Scope
and materials select the instance-specific repair.
