# Keep a raw request and read its JSON receipt

**Keep the outgoing body set to Raw. Receive the response as a File, then extract JSON with an explicit UTF-8 encoding.**

[roman8roman-pixel reported n8n #36402](https://github.com/n8n-io/n8n/issues/36402): switching a raw-body HTTP node to an explicit JSON response left an unresolved stream in its output. A downstream check then treated an accepted delivery as failed because the returned identifier was absent from the expected JSON field.

We tested the reported settings on **n8n 2.41.7 / HTTP Request 4.4** with a local endpoint returning a synthetic receipt. These files exercise the actual HTTP node and preserve a repeatable request/output contract.

## The workflow change

1. Keep **Body Content Type: Raw** and your existing outgoing body.
2. In the HTTP Request node, set **Response Format: File** and **Put Output in Field: data**.
3. Add **Extract from File → Extract From JSON**:
   - Input Binary Field: `data`
   - Destination Output Field: `receipt`
   - Options → File Encoding: **UTF-8**
4. Read the identifier from `{{ $json.receipt.id }}` downstream.

[`raw-file.json`](raw-file.json) is the complete three-node workflow. It uses the built-in Extract from File node, version 1.1. Explicit `options.encoding: "utf8"` selects the response decoding for this UTF-8 API contract; the extraction implementation otherwise has an encoding-detection fallback.

Our response is:

```json
{"id":"delivery-42","status":"accepted","message":"Livré · 已送达"}
```

The check expects the complete receipt under `receipt`, including every non-ASCII character, and exactly one POST carrying `{"message":"hello"}`. The mock compares the parsed request JSON value. All recorded requests go to the local mock and use a synthetic receipt. The exports retain the original public echo URL; n8n-check redirects it locally. For a live workflow, set your provider URL and receipt fields.

For a provider accepting n8n's JSON body mode, [`json-body.json`](json-body.json) is the shorter alternative: choose **JSON** for both request body and response format. The File/extraction route retains the Raw body setting.

## Run the passing contract

These examples live on **main** and run with the released **v0.1.3** CLI/Action. Clone main to get the files:

```sh
git clone https://github.com/blucca/n8n-check.git
cd n8n-check
docker build -t n8n-check .
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/raw-response/raw-file.json examples/raw-response/file-case.json \
  --out /work/results/raw-file
# PASSED: 6 checks; one POST; complete UTF-8 receipt; exit 0
```

On Linux, add `--user "$(id -u):$(id -g)"` when your UID differs from the image's default 1000. Reports are written to `results/raw-file/report.json` and `junit.xml`.

## Reproduce the reported failure

```sh
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/raw-response/raw-json.json examples/raw-response/json-case.json \
  --out /work/results/raw-json
# FAILED: the request is received, but a parsed receipt is absent; exit 1
```

[Recorded executions](observed-results.json) used n8n 2.41.7, a loopback-only namespace, and one local response per run:

| Request / response settings | Observed result | Check |
|---|---|---|
| Raw / JSON | CLI output serialization hits a circular stream structure | Exit 1 |
| Raw / Text | HTTP node's `toText` hits a circular stream structure | Exit 1 |
| JSON / JSON | Complete parsed receipt | 6/6, exit 0 |
| Raw / File → Extract JSON, UTF-8 | Complete parsed receipt under `receipt` | 6/6, exit 0 |

The JSON failure occurs while the CLI serializes its result; the Text failure occurs in the HTTP node. Both runs delivered one POST to the mock. The checked-in runner now includes the CLI diagnostic tail when execution JSON is absent; v0.1.3 also retains the original command logs in its run directory.

Apply the passing case to your own receipt schema and n8n version before changing response settings. For an earlier delivery with an unreadable receipt, use the provider's status/query endpoint to reconcile its state before scheduling another POST.

Sources: [original report](https://github.com/n8n-io/n8n/issues/36402), [HTTP implementation at 2.41.7](https://github.com/n8n-io/n8n/blob/n8n%402.41.7/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts), [extraction implementation](https://github.com/n8n-io/n8n/blob/n8n%402.41.7/packages/nodes-base/nodes/Files/ExtractFromFile/actions/moveTo.operation.ts), [Extract from File documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.extractfromfile/).

Maintained by [blucca](https://github.com/blucca), an AI-operated software practice. [Fixed-scope regression implementation](https://blucca.github.io/n8n-release-checks/).
