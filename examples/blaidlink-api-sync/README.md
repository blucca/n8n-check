# An empty API array must reach the failure record

Independent regression check for **Blaidlink Labs' Resilient REST API Sync**.

Recorded result: the original HTTP 200 `[]` run is n8n-successful with `Failure Record` count **0**; the fixed complete workflow passes the same failure obligation **11/11** on n8n 2.41.7.

## Source and license

Original: [BlaidLink/blaidlink-n8n-reliability-starters](https://github.com/BlaidLink/blaidlink-n8n-reliability-starters/blob/e7a2c621e5c28ffe1d4dd82c14059acd22055707/workflows/resilient-rest-api-sync.json), commit `e7a2c621e5c28ffe1d4dd82c14059acd22055707`.

The byte-identical template was submitted in [FlowKit PR #6](https://github.com/harshit-exe/FlowKit/pull/6), head `f183876e5bc4988bc3a517f6e2b458a7b573a52e`.

`original.workflow.json` preserves its complete 13-node export. The original workflow is MIT-licensed, copyright Blaidlink Labs; its full notice is in `LICENSE`. The proposed modification uses the same license. This verification and patch were prepared autonomously with Codex for blucca.

## The existing acceptance obligation

The author's Code node explicitly throws `EMPTY_RESPONSE: The upstream API returned no records.` for an empty API result. Its error connection leads to `Sanitize Failure` and then `Failure Record`.

On **n8n 2.41.7**, HTTP Request v4.4 expands a JSON array into separate n8n items. An HTTP 200 body of `[]` therefore emits zero items. The normalizer and both failure nodes are skipped, and the original n8n execution succeeds with no failure evidence. The external n8n-check oracle still executes and catches `Failure Record` expected 1, got 0.

## Proposed minimal fix

The full graph, node IDs, connections, retries, credentials, settings and original metadata stay unchanged. `fix.patch` changes three nodes:

1. HTTP Request: enable **Include Response Headers and Status** (`fullResponse: true`), keeping `[]` inside one response-body item.
2. Normalizer: flatten `item.json.body`, so the existing empty-response throw is reached.
3. Sanitizer: preserve a string-valued Code-node `error`, alongside the existing request-error objects.

The n8n Code-node diagnostic adds ` [line 15]` to the message. The exact message assertion is pinned to that observed n8n 2.41.7 output. `empty.literal-message.case.json` retains the initial literal-only message expectation and its diagnostic mismatch is recorded separately.

## Three inputs, same existing CLI

| Input | Original | Fixed | Request count |
|---|---|---|---:|
| HTTP 200 JSON `[]` | n8n success; no failure record; oracle exit 1 | Explicit EMPTY_RESPONSE failure record; oracle exit 0 | 1 |
| HTTP 200 two complete records | Full normalized rows and ordered IDs 42, 43; exit 0 | Same complete output; exit 0 | 1 |
| Persistent HTTP 503 | One handled failure record; exit 0 | Same stable failure fields; exit 0 | 3 |

These cases inject one `{}` at `Run Demo`, retain the author's configuration node and static reference, and replace only the HTTP URL with a local mock. All response data are synthetic. No customer instance, credential or external endpoint is used during the runs. Timestamps remain authored runtime values; contracts check stable status/error/retry fields and complete normalized success JSON.

## Try the empty response in your own n8n — no CLI

1. Import `fixed.workflow.json` into a new inactive workflow.
2. Open **Set Demo Configuration**. Change the string field **`request_url`** to `https://jsonplaceholder.typicode.com/users?username=n8n-check-empty-example` (confirmed HTTP 200 with JSON `[]`). Keep **`required_fields`** at `id,name,email`. The exact exported setting is `parameters.assignments.assignments[]` where `name` is `request_url` and `value` is the URL; edit the value, not the `Fetch API Records` expression.
3. Execute **Run Demo**. Open **Failure Record**: it should contain one item with `status: failed`, `error: upstream_request_failed`, and the EMPTY_RESPONSE message. **Validated Records** should have no items. The execution remains successful because the author deliberately handles the error on its error output.
4. Restore `request_url` to the original `https://jsonplaceholder.typicode.com/users` to try the nonempty demo. This manual use calls your chosen test endpoint; the recorded CLI cases above use local mocks only.

The empty-array URL above was confirmed by one anonymous HTTP GET and JSON parse. That check records the endpoint response; the author's own n8n rerun is still pending. This manual procedure reads the existing export fields and keeps the complete 13-node graph and author's scope unchanged.

Native editor tests keep their existing local-transform scope; this complete HTTP/error-routing example uses the existing CLI/Docker/Action route.

## Reproduce with the free released tool

Build the existing **n8n-check 0.1.9** image once (this downloads the official n8n 2.41.7 base image):

```sh
git clone --branch v0.1.9 --depth 1 https://github.com/blucca/n8n-check.git n8n-check-source
docker build -t n8n-check:0.1.9 n8n-check-source
sh run.sh
```

Each Docker run uses `--network none`, a 650 MiB memory limit and no swap. JSON, JUnit and the prepared workflow are written beneath `results/`. The original empty case intentionally returns 1; `run.sh` returns 0 when all six observed expectations match.

The recorded local verification uses the released registry package 0.1.9 and an already installed n8n 2.41.7 inside an equivalent loopback-only namespace with a 650 MiB cgroup limit. The tool's reports identify its runner version, runtime version, enforced network boundary, requests and executed assertions.

### Direct released CLI command

With Node.js 24+ and your installed n8n CLI, the released package can run the same case directly in a loopback-only namespace:

```sh
# Run inside a namespace with only the loopback interface enabled.
npx --yes @blucca/n8n-check@0.1.9 fixed.workflow.json empty.case.json \
  --n8n /path/to/n8n --out results/fixed-empty --json
```

The runner enforces loopback-only networking by default. The Docker commands above supply that boundary and the pinned n8n 2.41.7 runtime. The full recorded inputs and results are linked in [`observed-results.json`](observed-results.json).


Recorded JSON/JUnit/execution files keep the measured checks and outputs. Local artifact paths have been shortened for public viewing.
