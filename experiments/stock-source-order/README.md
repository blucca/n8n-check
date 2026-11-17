# Stock source-order contract

A tiny consumer check for an inventory worker that sets absolute quantities.
It keeps **duplicate delivery** and **source freshness** as separate acceptance
contracts. The receiver is a local HTTP fixture; source versions are declared
before delivery, independent of the worker's returned status.

## Observed result

One inventory item, one location. The source first produces v1=12, then v2=7.
The latest source quantity is therefore **7**.

| Delivery into the worker | Return values | Physical HTTP writes | Receiver final | Latest-source contract |
| --- | --- | --- | ---: | --- |
| v1 then v2 | updated, updated | 12 → 7 | 7 | PASS |
| v2 then previously unseen v1 | updated, updated | 7 → 12 | 12 | FAIL |

In both panels, repeating the already-successful v1 event returns `duplicate`
and sends **zero additional HTTP requests**. Successful-ID duplicate protection
works in this experiment.

The second panel is a late **first** delivery of a different event ID. Absolute
writes preserve the latest source quantity when source ordering/freshness is
enforced before or during the write. A queue that preserves source version
order per item/location excludes the reversed panel. Arrival FIFO and source
version order are different queue contracts.

## Baseline and measurement environment

- Baseline: the `setStock` TypeScript sample in
  [werun.dev's November 12 inventory guide](https://werun.dev/blog/shopify-inventory-sync-fix),
  retrieved as article text on November 17, 2026. The original raw page returned
  HTTP 403 in this environment, so direct-HTML comparison was unavailable.
- Source adaptation: only the `ENDPOINT` constant points at the local fixture.
  The sample's function, Node `fetch`, event-ID Set, request body and success
  handling retain the retrieved sample's logic.
- Runtime: Node **v26.12.0**. Four physical loopback HTTP POSTs, two successful-ID
  duplicate calls. Each order panel gets its own fresh module/processed Set.
- Receiver model: accept the `ignoreCompareQuantity: true` absolute-write
  request and return a successful GraphQL response with `userErrors: []`.
- Measured boundary: the worker input and HTTP receiver. Queue enforcement,
  real Shopify mutation behavior and a merchant's current inventory belong to
  their separate environment contracts. Retry branches were outside this run.

`observed.json` contains the actual request bodies and receiver quantities.
`experimentObservationsPassed` records the checks of these observations; the
reversed panel's **business contract remains FAIL**.

## Run against the sample

Use a scratch directory. Copy the article's TypeScript `setStock` sample into
`fixture-setStock.mts`, then replace only its endpoint definition with:

```ts
const ENDPOINT = process.env.STOCK_FIXTURE_ENDPOINT!;
```

Leave the function and request logic intact, then run with Node v26.12.0:

```sh
node /path/to/check_source_order.mjs ./fixture-setStock.mts ./observed.json
```

The check starts its own loopback HTTP receiver and supplies a synthetic token.
Its assertions cover both expected order outcomes and the zero-POST duplicate
control. For your own worker, declare its source-order acceptance contract
first, then put the same two-event case through your actual queue boundary.

The harness is original MIT code within n8n-check. The third-party worker source
is referenced at its original article and is excluded from this repository.
Main CLI, builder and n8n runtime behavior retain their existing release.
