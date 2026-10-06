# Morsof invoice-history regression contract

Executable coverage for the seven batch-history cases in [Morsof issue #7](https://github.com/Morsoflab/n8n-automation-templates/issues/7), using the workflow from [PR #8](https://github.com/Morsoflab/n8n-automation-templates/pull/8), real n8n Code/If/Data Table nodes, and isolated SQLite storage.

## Source and results

- Current workflow: `3d8c61ee5b0e37e7e0052f53e7839db011b9c0de`.
- Historical first version: `adb2d3c3aa7534bcce53d955938e24c9f061b315`.
- `prepare.mjs` downloads those exports and verifies their SHA-256 hashes.
- Runtime: n8n **2.41.7**, n8n-check **0.1.3**, Node **26.10.0** in the recorded run; Linux loopback-only networking.

| Case | Current result | Persisted history rows |
|---|---|---:|
| Two eligible invoices | 9/9 | 2 |
| Eligible + paid | 9/9 | 1 |
| Existing + new | 9/9 | 2 |
| Duplicate input | 9/9; one stored ID shared by both outputs | 1 |
| Reordered existing + new | 9/9 | 2 |
| Empty history, three eligible | 9/9 | 3 |
| Multiple existing rows | 9/9; newest matching row selected | 4 |
| Unchanged second execution | 9/9; both already prepared; zero writes | 2 |

The historical export fails with `Multiple matches` in **Check Reminder History**, produces zero writes, and exits 1 under the same two-invoice contract. Its first error occurs before the reported global-limit data-loss path. The current export passes all seven cases.

For same-batch duplicates, **Ready for Review** physically emits both items: the first has `outputPath=ready_for_review`; the second has `outputPath=already_prepared` and `actionReason=duplicate_in_execution`. Both reference the one stored row. The separate **Already Prepared** node receives matches from history loaded before this execution. A downstream approval consumer can select `outputPath === "ready_for_review"` to process fresh drafts.

The replay check executes the same imported workflow twice against the same isolated database. It checks the original stored IDs, complete unchanged database rows, and original preparation timestamps.

## Run

Requirements: Node 24+, the n8n 2.41.7 CLI on `PATH`, an n8n-check v0.1.3 checkout, Linux `unshare` and `ip`.

```sh
# Network access is used for the two pinned source downloads.
node prepare.mjs

# Supply the directory containing n8n-check's bin/ and src/.
# Example: export PATH=/path/to/n8n-runtime/node_modules/.bin:$PATH
unshare --user --map-root-user --net sh -c \
  'ip link set lo up && ./run.sh /path/to/n8n-check ./results'
```

A single case:

```sh
unshare --user --map-root-user --net sh -c \
  'ip link set lo up && node /path/to/n8n-check/bin/n8n-check.mjs \
   fixed.workflow.json two-eligible.case.json \
   --n8n "$PWD/n8n-datatable.cjs" --out results/two-eligible'
```

Each case writes JSON + JUnit and retains its actual execution output and isolated SQLite database. `run.sh` expects the historical regression to exit 1 and finishes with the persistent replay check.

## Fixture adaptations

The prepared exports preserve the upstream business-processing nodes, expressions, table schema, and connections. Four explicit fixture changes make the upstream manual test plan repeatable:

1. Set the documented `EVALUATION_DATE` test override to `2030-06-20`.
2. Replace **Load Fictional Invoice Samples** with the case's synthetic invoice array.
3. Add a fixture-only seed branch between table creation and the original history load. This inserts requested history fixtures through the real Data Table node, including duplicate historical keys.
4. Append read-only terminal projections that check invoice/customer/recipient identity, classification, stage, routing, draft linkage, stored row IDs, and writes. The full original outputs remain in `execution.json`.

The adapters use fictional `.example` recipients. Every execution stays inactive and contains the upstream preparation workflow, its local fixtures, and its observation nodes.

## Data Table CLI adapter

n8n 2.41.7's server startup initializes the Data Table module. Its standalone `execute` command omits that initialization and reports `Attempted to use Data table node but the module is disabled` for this workflow.

`n8n-datatable.cjs` is pinned to **2.41.7**. It runs the ordinary CLI with the upstream `DataTableModule.init()` and context registration added after `Execute.init()`. All Data Table node code, proxy validation, and database writes remain the upstream implementation. Its small internal initialization bridge should be reviewed when changing runtime versions. The source workflow and n8n-check runner files stay unchanged.

`replay.mjs` uses n8n-check 0.1.3's execution helpers for the second invocation and Node's `node:sqlite` to compare actual rows. The seven ordinary cases use the published CLI case format directly.

## Coverage boundary

The contract covers batch correlation, existing-history matching, duplicate inputs, output linkage, and persistent replay. The upstream README's broader contact/date-validation matrix and insertion-failure simulation are separate cases. The historical `Multiple matches` failure and current batch success are the measured comparison.

Upstream workflow source is MIT, attributed in `UPSTREAM-LICENSE`.
