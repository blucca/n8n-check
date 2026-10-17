# After the reported trigger passes

Three **development seed families** for evaluating workflow repairs on additional inputs and execution sequences. The repair author knows these development references. A separate [prospective paired pilot](PILOT-PROTOCOL.md) freezes natural-model repair prompts, equal invocation budgets and model-hidden final inputs before generation.

## What the seeds measure

| Family | Visible trigger / candidate | Added contract | Provenance |
|---|---|---|---|
| Invoice history | The public batch-history fix passes its original two-invoice fixture. | Same invoice and reminder stage with contradictory customer or amount requires review; an unrelated invoice must still persist. | Public Morsof workflow plus an **author-added same-batch policy**. |
| Retry identity | A synthetic stable asset-ID key handles commit-then-503 and replay of the same operation. | A new revision or another tenant is a distinct operation and must produce its own durable effect. | Self-authored synthetic incorrect repair and inputs. |
| Raw JSON receipt | The existing File response + Extract from File repair handles an object. | Preserve root arrays and a UTF-8 BOM/multibyte object, one receipt value per request. | Self-authored exports derived from the reported n8n raw-response problem; positive controls. |

These are three source families. Variants, execution steps and assertions remain grouped within their family. The old no-key retry after a committed write is a baseline control. The added retry challenge concerns **logical-key scope and versioning**.

The invoice policy is deliberately explicit. It applies to contradictory members of the **same input batch**. The public upstream policy groups the reminder key and records its first member. This experiment measures the stricter policy above; it does not attribute that policy to the original author. A cross-execution conflict against earlier history requires a separate contract and reference.

## Method

`seed-gate.mjs` writes the input, policy and workflow plan before running any arm. It reuses n8n-check's execution, isolation and reporting functions with real n8n 2.41.7 nodes.

- The invoice reference adds one group-conflict guard. Its oracle accepts an explicit review/failure outcome for every conflicting input and requires the unrelated invoice to complete. Persisted Data Table rows are read from SQLite.
- All retry arms use the **same SQLite-backed HTTP service**, error injection and retention policy. The service commits before its first 503. The original omits a key, the candidate keys on asset ID, and the reference keys on `(tenant, asset, revision)`. Separate n8n CLI processes share the service's persisted state. The reference changes client behavior only.
- Raw response checks run both the native extractor and an alternative Code-node parser against the same response bytes. The POST body and full receipt value are graded.

The result establishes whether these oracles distinguish the authored controls. It supplies no model repair success rate, independent real-world prevalence estimate or claim that these mechanisms are newly discovered.

## Recorded seed run

On 2026-10-18, all 22 planned runtime invocations behaved as specified: 16 positive controls passed and six negative controls failed. Both new failure families had successful engine executions in their failing candidate arms. [Observed results](observed-results.json) retain every arm's outcome.

The durable retry counts make the distinction concrete:

| Sequence checkpoint | Asset-only candidate | Full logical-key reference |
|---|---:|---:|
| Initial two operations, one committed 503 | 2 rows | 2 rows |
| Replay the same operations | 2 rows | 2 rows |
| New revision of the first asset | 2 rows: missing effect | 3 rows |
| Same asset ID in another tenant | 2 rows: missing effect | 4 rows |

Both invoice conflict variants failed the candidate's review/persistence checks while the reference preserved normal invoice B. Both raw-response implementations passed all three response shapes.

The separate manually dispatched `Gemma CPU access probe` workflow makes one coding request with the public Apache-2.0 E2B LiteRT model on a standard GitHub CPU runner. It is an inference access check, excluded from the seed results and future repair evaluation. Its pinned runtime, model revision and prompt are in `model-smoke.py` and `.github/workflows/gemma-access.yml`.

[The first real access run](model-access-results.json) succeeded: 3.206 seconds to load and 2.899 seconds to generate an answer. Asked for distinct keys over exact tenant/asset/revision strings, Gemma returned hyphen concatenation. A **post-hoc** JavaScript check found a collision between `(team-a, asset-7, r1)` and `(team, a-asset-7, r1)`. This counterexample was constructed after reading the answer and stays outside the prospective repair pilot. It motivates testing identities beyond ordinary examples.

## Run

Requirements: Node 24+, n8n **2.41.7**, Linux `unshare` and `ip`. Runs are sequential. All generated workflows, logs and databases go beneath the supplied fresh temporary directory.

From the repository root, put the n8n binary on `PATH`, then:

```sh
OUT=/absolute/path/to/temp/repair-seeds
mkdir -p "$OUT/morsof"
cp examples/morsof-invoice-history/{prepare.mjs,n8n-datatable.cjs,UPSTREAM-LICENSE} "$OUT/morsof/"
curl -LfsS --max-time 30 https://raw.githubusercontent.com/Morsoflab/n8n-automation-templates/3d8c61ee5b0e37e7e0052f53e7839db011b9c0de/templates/invoice-payment-follow-up/invoice-payment-follow-up.json -o "$OUT/morsof/fixed.source.json"
curl -LfsS --max-time 30 https://raw.githubusercontent.com/Morsoflab/n8n-automation-templates/adb2d3c3aa7534bcce53d955938e24c9f061b315/templates/invoice-payment-follow-up/invoice-payment-follow-up.json -o "$OUT/morsof/broken.source.json"
node "$OUT/morsof/prepare.mjs"
unshare --user --map-root-user --net sh -c \
  'ip link set lo up && node "$1/experiments/heldout-repair/seed-gate.mjs" "$2"' sh "$PWD" "$OUT"
```

Exit 0 means every positive control passed and every planned negative control failed. See `summary.json`, `gate.json`, per-run `oracle.json`, execution output and `stored-rows.json`. The durable service files are `services/*/effects.sqlite`. Use a fresh output directory for each run so prior database state stays separate.

Source attribution: [Morsof issue #7](https://github.com/Morsoflab/n8n-automation-templates/issues/7), [PR #8](https://github.com/Morsoflab/n8n-automation-templates/pull/8) and the copied upstream MIT license; [n8n raw-response issue #36402](https://github.com/n8n-io/n8n/issues/36402). n8n itself retains its own license. The n8n-check runner and these experiment files use this repository's MIT license.
