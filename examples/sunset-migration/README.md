# Retire the Function node. Keep the hot leads.

A small, runnable output contract for the **Keep hot leads** filter in [Larik's MIT lead-enrichment example](https://github.com/larik15/n8n-sunset/blob/6e340f578f4d1b9c95a6c1027faa33df955ae955/examples/workflows/lead-enrichment.json).

The source filter is `Number(item.json.score) >= 7`. Its Code-node replacement uses **Run Once for All Items** and `$input.all()`. The fixture scores are `8`, `6`, and the string `"7"`; the contract keeps **lead-A and lead-C**, complete JSON rows in input order. C's score stays a string.

## Import and run

1. [Download the migrated editor test](https://raw.githubusercontent.com/blucca/n8n-check/main/examples/sunset-migration/migrated.editor-test.json). Import it into your existing n8n and **Execute workflow**. **Check expected output** returns `status: "passed"`, count **2**.
2. [Download the controlled one-row test](https://raw.githubusercontent.com/blucca/n8n-check/main/examples/sunset-migration/controlled-bad.editor-test.json). Import and execute: the contract fails with **expected 2 items, got 1**.

Both files are inactive, self-contained v1 workflows with the fixture embedded. Keep the independent oracle branch below the tested branch. The source `*.slice.json` files are generator inputs; the prepared/editor files are the ready-to-import workflows.

## Recorded comparison

| Local filter | n8n-sunset target-3.0 scan | Actual n8n 2.41.7 execution | Kept leads |
|---|---|---|---|
| Original Function v1 | exit 1: removed-node finding | succeeds | A, C — complete rows |
| Equivalent Code v2 + output contract | exit 0, zero findings | contract passes | A, C — complete rows |
| Controlled Code truncation, ordinary run | exit 0, zero findings | succeeds | A only |
| Same controlled truncation + output contract | same Code slice | contract fails | A only |

The controlled variant adds `.slice(0, 1)` after the correct filter. It illustrates a lost-row regression during migration. [Run its ordinary workflow](controlled-bad.prepared.json) to see the successful one-row execution; [run the original baseline](legacy.prepared.json) to see both qualifying rows. Full observed rows, exit codes, oracle execution and scan warnings are in [the recorded results](observed-results.json).

The static scan uses `n8n-sunset@0.2.0`, `--target 3.0`, `--as-of 2026-11-14`. Its bundled registry is dated 2026-10-06; the reported 39-day freshness warning is preserved in the results. Actual runtime measurements here use **n8n 2.41.7**. The case covers the fixed scored-lead input and local filtering; scoring and provider calls stay in the original example.

## Regenerate locally

From this directory, with Node 24+:

```sh
npx --yes @blucca/n8n-check@0.1.9 editor-test migrated.slice.json hot-leads.case.json --out my-editor-test.json
npx --yes n8n-sunset@0.2.0 migrated.slice.json --json --target 3.0 --as-of 2026-11-14
```

The first command generates a new file; the second scans JSON offline. Execute the generated file in your own n8n to measure your runtime. Replace the three synthetic leads and [case expectations](hot-leads.case.json) with your own local transformation contract for repeat checks.

**Credits:** source filter and compatibility scanner — Larik / n8n-sunset (MIT). Synthetic fixture, Code migration, native output contract and independent runs — Blucca / n8n-check. [License](LICENSE).
