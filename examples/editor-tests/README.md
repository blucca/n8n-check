# Run a fixed-input check in your existing n8n editor

The [case builder](https://blucca.github.io/n8n-check/) can download a separate test workflow. Import it into your existing n8n, then **Execute workflow**. No n8n-check CLI, Docker, dataset or monitoring service is required for this route.

## Try a recorded control

1. Download [filter-fixed.json](filter-fixed.json) and import it as a new workflow.
2. Execute the workflow. **Check expected output** returns `status: "passed"`: eight relevant rows and their context are preserved.
3. Change **Confidence Gate** from `score >= 0.7` to `score >= 1` and execute again. The check throws on the missing expected rows. The independent check branch still runs after the tested branch produces zero items.

The downloadable controls were generated, imported and executed on stock **n8n 2.41.7**:

| Test | Native result | What it checks |
|---|---|---|
| [filter-fixed](filter-fixed.json) | pass, exit 0 | Eight selected rows and the complete context |
| [filter-empty-skipped](filter-empty-skipped.json) | expected error, exit 1 | No rows; Build context never ran; the independent oracle still ran and rejected the missing context |
| [empty-expected](empty-expected.json) | pass, exit 0 | An explicitly expected empty output, including a skipped downstream node |
| [ids-fixed](ids-fixed.json) | pass, exit 0 | Two correct IDs while timestamps change |
| [ids-wrong](ids-wrong.json) | expected error, exit 1 | Same two-item count, wrong IDs |

Exact errors, executed-node order and successful check outputs are in [observed-results.json](observed-results.json). These are synthetic controls run by the project, not external adoption reports. Your downloaded workflow runs on your instance's n8n version.

## Build your own

Pin the fixture input and desired output after a known-good run, then export the workflow. In the builder, select those nodes, review the input and expected values, and choose **Download editor test (.json)**. A JSON slice between integrations can use **Stop after selected output**.

The download replaces the fixture boundary with the fixed input, removes output pins and production ownership/settings, and adds a last **Check expected output** branch. Each target's selected output is compared once. Full JSON ignores object-field insertion order; arrays, duplicates, selected-field presence and item counts are checked. Keep the independent check branch below the tested branch: v1 executes these branches top-to-bottom. Change your transformation, not the expected contract, when reproducing a regression.

The test validates the recorded node-output contract. External delivery and business/source relationships retain their own evidence contracts.

## Current editor scope

- v1 execution order; one incoming connection per node, no loops or waiting joins.
- Local Code, Edit Fields (Set), Filter, IF, Switch, No Operation, Sort, Limit, Split Out, Aggregate and Item Lists nodes.
- Fixed JSON batch inputs; exact JSON, count or selected-field assertions.
- Merges, waits, loops, sub-workflows and HTTP mocks continue through the existing CLI/Action route. The builder explains the specific unsupported node or connection before download.

n8n also has native Evaluation/dataset and custom-metric tools. This bridge is the short path from the builder's existing fixed-input contract to a manual engine pass/error.
