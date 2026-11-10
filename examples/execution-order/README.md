# Keep the workflow's scheduling setting

n8n-check 0.1.8 preserves explicit `v0` and `v1`, and leaves an omitted `settings.executionOrder` omitted. Earlier runner releases filled an omitted setting with `v1`.

In the native **n8n 2.41.7** control, both branches returned the same `order-1` item. Their saved execution indices differed:

| Export setting | First branch | Upper index | Lower index |
| --- | --- | ---: | ---: |
| omitted | Lower | 3 | 2 |
| `v1` | Upper | 2 | 3 |

The branch connection lists Lower first; Upper's canvas position is above Lower. The native default selects legacy scheduling. The prepared workflow now keeps that selection. [Recorded results](native-results.json) and [the preparation regression test](../../test/core.test.mjs) capture the two contracts.

With the Docker image built as in the repository's Quick start:

```sh
docker run --rm --network none -v "$PWD:/work" n8n-check examples/execution-order/omitted.json examples/execution-order/case.json --out temp/order-omitted
docker run --rm --network none -v "$PWD:/work" n8n-check examples/execution-order/v1.json examples/execution-order/case.json --out temp/order-v1
```

Both output checks pass. Each report's `runDirectory` contains `execution.json`; compare `data.resultData.runData.Upper[0].executionIndex` and the corresponding Lower field. The supplied fixture is synthetic, credential-free, and makes zero HTTP requests.

The motivating report is [n8n #43381](https://github.com/n8n-io/n8n/issues/43381), by sinehypernova-0718: a separate native agent/tool observation failure under legacy ordering. This local control measures workflow-copy fidelity and branch scheduling. [n8n 2.43.0's core](https://github.com/n8n-io/n8n/blob/n8n%402.43.0/packages/core/src/execution-engine/workflow-execute.ts#L239) also classifies an omitted setting as legacy.
