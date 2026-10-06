# Successful execution, missing business data

A leftover source filter removes eight relevant retrieval rows. The n8n CLI still exits 0. Exact output assertions turn the regression check red.

This is an original **synthetic reconstruction** of the failure class described in [the community's workflow-test proposal](https://community.n8n.io/t/306721). The fixture contains eight high-score rows from `current-index` plus one low-score distractor. The intended gate accepts scores ≥ 0.7.

The entire fix in `Confidence Gate`:

```diff
-return $input.all().filter(item => item.json.score >= 0.7 && item.json.source === "legacy-index");
+return $input.all().filter(item => item.json.score >= 0.7);
```

`case.json` asserts all eight rows at **Confidence Gate** and their exact IDs in **Build context**. The low-score ninth row exercises the filter's rejection behavior. HTTP mocks are an empty array: every node in this example runs locally.

## Run with a browser

1. [Fork n8n-check](https://github.com/blucca/n8n-check/fork).
2. In your fork, open **Actions** and enable workflows if prompted.
3. Open **Try a silent data-loss regression → Run workflow**.
4. Select `fixed`, then repeat with `broken`.

The `fixed` run should be green; `broken` should be red. Each run includes a job summary and a downloadable `silent-filter-results` artifact with JSON/JUnit. [The workflow file](../../.github/workflows/try-example.yml) uses the released v0.1.2 Action at its full commit SHA. Fork the current repository to include this newer example.

For your own workflow, replace the two paths in that YAML and adapt `input.node`, fixture items and output assertions. [Case-format reference](../../README.md#your-first-case).

## Run locally

From a checkout of this repository's current `main`, with Docker:

```sh
docker build -t n8n-check .
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/silent-filter/broken.json examples/silent-filter/case.json \
  --out /work/results/broken
# n8n execution succeeds; two output assertions fail; exit 1

docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/silent-filter/fixed.json examples/silent-filter/case.json \
  --out /work/results/fixed
# n8n execution succeeds; every assertion passes; exit 0
```

On Linux, add `--user "$(id -u):$(id -g)"` when your user ID differs from the image's default 1000. Both exports also import into the n8n editor: `Retrieved rows` includes the synthetic fixture, so **Execute workflow** demonstrates the same filter behavior there.

## Observed results

[Recorded JSON](observed-results.json) contains exact expectations, actual outputs, requests and runtime versions from our runs. The test boundary is the exported Code-node slice with fixture input, running in n8n 2.41.7. Production trigger delivery, database retrieval and model responses have their own acceptance contracts.

| Check | Broken | Fixed |
|---|---|---|
| n8n execution succeeds | Pass | Pass |
| Confidence Gate: eight exact items | Fail: `[]` | Pass |
| Build context: count + exact IDs | Fail: `[]` | Pass |
| Runner exit | 1 | 0 |

[Fixed-scope regression implementation](https://blucca.github.io/n8n-release-checks/) covers designing fixtures and checks for your workflow release.
