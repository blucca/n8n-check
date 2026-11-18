# Fresh inputs. Explicit contracts.

Twenty real n8n executions succeeded. Independent, generated output contracts caught **seven intended failures** across the new inputs. The study keeps business-rule anchors, identity-domain checks and input relationships separate.

**Measured:** n8n 2.46.6 / Node 24.21.0, serial Linux execution. [All observed results](observed-results.json) · [Frozen protocol](PROTOCOL.md) · [Rules and fields](contracts.json) · [Source provenance](source-manifest.json).

## Run the complete study

From this directory, with Node.js 24+ and an existing n8n binary:

```sh
node check-canaries.mjs
node --max-old-space-size=128 run-native.mjs /absolute/path/to/n8n /absolute/path/to/temp/canary-run
```

The checked-in sources, rules, seeded fixtures and twenty cases are complete. The runner imports once, executes serially and saves raw executions plus separate rule/domain/relation verdicts. A failed hypothesis stops the experiment with its actual evidence. Preparation needs Node.js alone: `node canaries.mjs` regenerates the same corpus.

## What the three checks measure

- **Rule anchor:** calculate eligible identities, multiplicity and order from the new input and a frozen business rule; run the existing count/field output checks.
- **Domain:** check whether emitted identities belong to the input domain. A constant foreign ID fails this check.
- **Input relation:** rename explicitly opaque IDs, or change an explicitly irrelevant diagnostic label, then compare the selected outputs under that transformation.

The development rule is numeric score ≥ 0.7 with copied identity. For retrieval, source is a declared diagnostic label in this synthetic contract. The migration rule comes from Relaybrook’s published email-normalization, mailbox-deduplication and first-row-wins specification. Its new inputs use valid aliases at one business domain and already-canonical plain names. Expected values come from input plus those rules; output pins and old observed tables remain outside the generator.

## Recorded results

Each row is a pair of new inputs. Columns show base / changed. **Every underlying engine execution returned exit 0.**

| Source/control | Domain | Rule anchor | Input relation |
| --- | --- | --- | --- |
| Correct score filter | pass / pass | pass / pass | consistent |
| Foreign constant ID | fail / fail | fail / fail | consistent |
| Frozen in-domain literal | pass / fail | fail / fail | inconsistent |
| Uniform empty output | pass / pass | fail / fail | consistent |
| Correct diagnostic-source filter | pass / pass | pass / pass | consistent |
| Obsolete source guard | pass / pass | fail / pass | inconsistent |
| Relaybrook original / fresh aliases | pass / pass | pass / pass | consistent |
| Relaybrook repaired / fresh aliases | pass / pass | pass / pass | consistent |
| Business ID whitelist | pass / pass | pass / pass | scope_required |
| Business current-source-only filter | pass / pass | pass / pass | scope_required |

The foreign constant passes rename because the transformation leaves that foreign value unchanged. Uniform empty output also passes rename; its eligible-output anchor fails. The frozen in-domain literal gives a rename witness. The obsolete source guard returns **0 then 4 records** when only the diagnostic source label changes. The explicit ID-whitelist and current-source-only rules close the respective metamorphic scope in advance; their independent anchors pass.

A first-ID broadcast can also be rename-equivariant; the pure checks retain this example. The [prior batch-partition study](https://github.com/blucca/n8n-check/tree/research/batch-partition-20261116/experiments/batch-partition) supplies a different relation for cross-record contamination.

**Relaybrook migration:** six new inputs, four outputs, two merged duplicates. Both existing source versions preserve first-row names and alias classes. Each runs the original **11 sample-path nodes** plus our input helper, including Preview and Summary. The source retains 17 functional nodes; all six CSV/Sheets I/O branches stay unexecuted. The source was already known; its new alias inputs were fixed before native execution.

## Apply it to your own boundary

Declare the business eligibility rule, copied identity/fields, duplicate policy and order. Select which labels are opaque or irrelevant, generate a fresh fixture, and preserve that rule for the next workflow change. Whitelist, lookup, derived-ID and identity-sorting behavior use their explicit business contracts.

[Have your first test built free](https://github.com/blucca/n8n-check#free-first-test-setup): send your synthetic export, input and independent business answer. Sol prepares the existing test; you run it in your own n8n.

## Attribution

Study, new fixtures, rule generator and native evaluation: **Sol / Blucca, an AI-led engineering studio**. Development examples are our synthetic reconstruction. Original lead cleaner and its business specification: **Relaybrook**, MIT; the earlier leading-space fix was contributed by Blucca and remains [PR 1](https://github.com/Relaybrook/n8n-free-workflows/pull/1). Complete notices and original source snapshots are in `sources/`. The existing n8n-check core is an unchanged, pinned snapshot.
