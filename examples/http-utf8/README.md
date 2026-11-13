# Catch a successful HTTP request that corrupts UTF-8 JSON

**HTTP 200. Workflow success. The customer's text still changes.**

This runnable case checks the complete HTTP Request node, using the valid French JSON from [dami1A's n8n #43713](https://github.com/n8n-io/n8n/issues/43713). The reporter identified the encoding path and the practical workaround: set **Response Format → JSON**. This example adds complete workflow exports, six exact-output fixtures, and before/after JSON + JUnit results.

Both exports receive the same local `application/json; charset=utf-8` responses. Their only difference is the HTTP node's response-format option:

- [`autodetect.json`](autodetect.json): default automatic detection.
- [`explicit-json.json`](explicit-json.json): Response Format explicitly set to JSON.
- [`case.json`](case.json): the same six response and expected-output contracts for either export.

## Run it in GitHub without a local runtime

1. Fork n8n-check and enable Actions.
2. Open **UTF-8 JSON before and after the response-format change → Run workflow**.
3. Inspect each version's verification step and download its JSON/JUnit artifact.

The [manual workflow](../../.github/workflows/http-utf8.yml) reuses the released v0.1.8 Action. It records the expected Auto failure, then requires the explicit-JSON result and the exact six-record before/after verification to pass.

## Run the whole workflow locally

From the n8n-check repository root, with Node.js 24+ and an installed n8n runtime:

```sh
node bin/n8n-check.mjs examples/http-utf8/autodetect.json examples/http-utf8/case.json \
  --allow-network --out results/http-utf8/autodetect
# Expected: exit 1 — output fields fail; the engine and HTTP request checks pass.

node bin/n8n-check.mjs examples/http-utf8/explicit-json.json examples/http-utf8/case.json \
  --allow-network --out results/http-utf8/explicit-json
# Expected: exit 0 — all checks pass.

node examples/http-utf8/verify.mjs results/http-utf8
```

Use `--n8n /path/to/n8n` to select the installed release. `--allow-network` records host networking for this trusted synthetic example; every HTTP Request is redirected to the runner's loopback mock. For a loopback-only container, use the repository's [Docker quick start](../../README.md#try-a-failure-then-its-fix) and the same three input files.

The `verify.mjs` check expects the specific affected-version behavior, including the two corrupted records and the four unchanged controls. For your own release gate, use the regular runner's strict output contract and update the input responses and expected items to your workflow's requirements.

## Why there are six records

| Input | Auto-mode output in the measured run | Explicit JSON |
|---|---|---|
| French JSON with `«\u00a0élargir\u00a0»` | `Point d'茅tape`; `D茅cision : 芦聽茅largir聽禄 le p茅rim猫tre.` | All fields preserved |
| `Küçük` | `K眉莽眉k` | Preserved |
| `Plain ASCII` | Preserved | Preserved |
| `Příliš` | Preserved | Preserved |
| `«C»` | Preserved | Preserved |
| A literal U+FFFD character | Preserved | Preserved |

The first two contain a three-code-point U+0080–U+00FF run. The Czech and ASCII-separated guillemet controls do not. A literal U+FFFD is valid UTF-8 and stays intact in this full-node run. These are deliberately chosen regression inputs, with the full JSON items checked rather than a character-incidence estimate.

## Recorded execution

| n8n runtime | Engine / HTTP requests | Auto contract | Explicit JSON contract |
|---|---|---|---|
| 2.41.7 | Both engines succeed; 6 HTTP 200 per mode | Fails on French/Turkish output | Passes all six records |
| 2.46.6 | Both engines succeed; 6 HTTP 200 per mode | Fails on French/Turkish output | Passes all six records |


The fixture contract covers HTTP Request 4.2, six HTTP 200 JSON responses, their GET paths/bodies/counts, and every returned field. All data is synthetic. The source report concerns the HTTP node's automatic encoding detection; the JSON workaround is a workflow configuration change.

The versioned [observed results](observed-results.json) record actual runtime versions, engine success, complete requests and output differences. The two malformed outputs match GB18030 decoding of their UTF-8 response bytes. Original bug analysis and workaround: [dami1A's report and follow-up](https://github.com/n8n-io/n8n/issues/43713).


## Repairing files that were already saved

[**Encoding-history recovery check**](recovery-provenance/) exercises a free
browser CSV cleaner on the recorded damage and healthy UTF-8 controls. Known
Turkish damage is restored; the measured revision also rewrites the healthy
Chinese surname `茅` to `é`. The two CSVs and exact results make that difference
replayable before applying recovery to historical data.
