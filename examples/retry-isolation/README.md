# Isolate HTTP retries to one input item

**Two input items. One temporary failure. Three ways to batch.** These fixtures run in real **n8n 2.41.7**, using **HTTP Request v4.2** and **Loop Over Items v3**.

Both inputs carry a nested `styling` object. The mocked service responds:

- Item **42**: first request `503`, subsequent requests `200` with `{"id":"render-42"}`.
- Item **43**: every request `200` with `{"id":"render-43"}`.

All HTTP nodes have **Retry On Fail** enabled, **Max Tries = 2**, and **Wait Between Tries = 1000 ms**.

## Observed results

| Workflow | Item 42 requests | Item 43 requests | Total | Final `Done` items |
|---|---:|---:|---:|---|
| [Direct multi-item retry](direct.json) | 2 | 2 | **4** | `render-42`, `render-43` |
| [HTTP Request Batching = 1](http-batching.json) | 2 | 2 | **4** | `render-42`, `render-43` |
| [Loop Over Items Batch Size = 1](loop.json) | 2 | 1 | **3** | `render-42`, `render-43` |

The first two runs observed `42→503, 43→200, 42→200, 43→200`. The loop run observed `42→503, 42→200, 43→200`.

HTTP Request's **Options → Batching → Items per Batch = 1**, with **Batch Interval = 1000 ms**, spaces requests within one node execution. Its retry still replays both input items in this test. Loop Over Items supplies one item per HTTP node execution, so retry operates on that one-item input. The completed `43` request is replayed in the first two workflows; the loop requests `43` once.

Every case checks exact request counts, full JSON request bodies, and both final output items. The loop case also checks the Loop node's **done output (index 0)**. [Recorded results](observed-results.json) include source hashes, request order and actual output. This is a synthetic HTTP contract; request counts measure transport calls. The fixture's `503` response models a temporary service failure.

## Run all three

From the repository root, build the pinned runtime and run:

```sh
docker build -t n8n-check .
for mode in direct http-batching loop; do
  docker run --rm --network none -v "$PWD:/work" n8n-check \
    "examples/retry-isolation/$mode.json" \
    "examples/retry-isolation/$mode-case.json" \
    --out "/work/results/retry-isolation/$mode" || exit "$?"
done
```

On Linux, add `--user "$(id -u):$(id -g)"` when your user ID differs from the image default. The runner starts its own loopback mock, injects the two case inputs and redirects `Render` to that mock. Every run writes `report.json` and `junit.xml`; the expected exit code is `0`. The repository's [CI](../../.github/workflows/ci.yml) runs these three cases alongside the object-body failure and fix.

## Import the workflow into n8n

**[Download the annotated editor template](editor-template.json)** for the one-item loop. Its two canvas notes include setup, connections, the exact response sequence and the adaptation contract. It uses built-in n8n nodes and your configured test endpoint.

Import `direct.json`, `http-batching.json` or `loop.json` using **Import from File**. Each is a complete workflow with a Manual Trigger, a `Fixture` Code node containing the two synthetic items, and a terminal `Done` node. The `*-case.json` files are inputs to n8n-check.

For an editor run, replace `Render`'s placeholder URL with your test service. The service must implement the response sequence above to reproduce the table; n8n-check provides it automatically during CLI runs. The exported URL expression is `https://api.example.com/renders/{{ $json.shortId }}`. Configure any credentials on your test service node as needed.

The loop's connections are:

```text
Start → Fixture → Loop Over Items (Batch Size = 1)
                    ├─ loop [output 1] → Render (Retry On Fail)
                    │                     └─ back to Loop Over Items input
                    └─ done [output 0] → Done
```

Keep **Reset** off for this fixed input list. Connect the last per-item node back to Loop Over Items, and put work that consumes all results after the **done** output. In this fixture, `Done` runs once with both HTTP response items.

## Apply the pattern

Use **Loop Over Items with Batch Size = 1** when each item should have its own HTTP-node retry scope. This protects other completed items from replay during a later item's node retry. In the observed input order, item `43` waits until `42` succeeds, then receives one request. Node retry still sends the failing item again: item `42` receives two requests in every case.

For writes, pair this scope with **server-side durable idempotency**. Choose a stable operation key, reuse it across retries, and have the receiving service persist the key and outcome consistently with the side effect. If the service accepts a write and its response is lost, the retry can recover the stored result for that same operation. Follow the target API's key scope, retention and concurrency contract. Request pacing, per-item retry scope and server-side duplicate handling each solve a distinct part of delivery.

### Upstream references

- [HTTP Request batching parameters](https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/README.md): items per batch and interval.
- [Loop Over Items parameters and outputs](https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches.md): saved inputs, per-iteration batches and combined done output.
- [Pinned HTTP Request implementation](https://github.com/n8n-io/n8n/blob/n8n%402.41.7/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts) and [workflow retry engine](https://github.com/n8n-io/n8n/blob/n8n%402.41.7/packages/core/src/execution-engine/workflow-execute.ts): implementation context for the measured behavior.
