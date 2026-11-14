# Sort amount strings by value.

Sort **typeVersion 1 / Simple** orders string amounts as text. Add a numeric sort key, sort that key, then return the original JSON. The amount text, customer and order ID all survive.

## Import and run

1. [Download the descending editor test](https://blucca.github.io/n8n-check/examples/amount-sort/fixed-descending.editor-test.json). Import it into your existing n8n and **Execute workflow**. **Check expected output** returns `status: "passed"`, count **3**.
2. [Download the ascending editor test](https://blucca.github.io/n8n-check/examples/amount-sort/fixed-ascending.editor-test.json). Import and execute. The same three complete orders pass in ascending order.

The files are inactive, self-contained v1 workflows. The three synthetic order rows are embedded; keep the independent **Check expected output** branch last. No CLI, Docker or credentials are needed for these editor tests.

| Order | Preserved `orderTotal` strings | Preserved IDs |
|---|---|---|
| Descending | `"452.8", "96.74", "83.28"` | C, A, B |
| Ascending | `"83.28", "96.74", "452.8"` | B, A, C |

## The three-node recipe

After your order-producing node:

1. **Edit Fields** adds `_amountSortKey`, type **Number**, value `={{ Number($json.orderTotal) }}`. **Include Other Input Fields** stays on.
2. **Sort / Simple** sorts `_amountSortKey` in your required direction.
3. **Return original orders** removes the helper field:

```javascript
return $input.all().map(item => {
  const { _amountSortKey, ...json } = item.json;
  return { ...item, json };
});
```

The regression contract compares complete JSON rows in the agreed order. It catches changed IDs, missing rows and rewritten amount text as well as a wrong ranking.

## Recorded native comparison

**n8n 2.41.7 and 2.47.7**, Sort node **1**, Edit Fields **3.4**, Code **2**, local SQLite/CLI. Each file was imported and executed in the actual engine. [Full observed rows and checks](observed-results.json).

| Input / workflow | Returned IDs | Ordinary Sort node | Output contract |
|---|---|---|---|
| String amounts, original descending | A, B, C | succeeds | fails: C must lead |
| String amounts, original ascending | C, B, A | succeeds | fails: B must lead |
| String amounts + numeric key, descending | C, A, B | succeeds | passes, complete rows |
| String amounts + numeric key, ascending | B, A, C | succeeds | passes, complete rows |
| JSON numbers, descending control | C, A, B | succeeds | passes |
| JSON numbers, ascending control | B, A, C | succeeds | passes |

[Run the ordinary string-sort workflow](raw-descending.workflow.json): it finishes successfully with the wrong numeric ranking. [Run its descending output contract](raw-descending.editor-test.json) or [its ascending contract](raw-ascending.editor-test.json): the independent check fails. The numbers controls use numeric JSON values; the fixed workflows preserve the original strings.

## Check your own orders

Download [the local slice](fixed-descending.slice.json) and [case JSON](fixed-descending.case.json). Replace the fixture in a copy of the case, state the complete rows in the required order, then generate a new editor test with Node.js 24+:

```sh
npx --yes @blucca/n8n-check@0.1.9 editor-test fixed-descending.slice.json my-orders.case.json --out my-orders.editor-test.json
```

Import that generated file into your n8n and execute. For installed-CLI checks and JSON + JUnit reports:

```sh
npx --yes @blucca/n8n-check@0.1.9 fixed-descending.slice.json my-orders.case.json \
  --n8n /path/to/n8n --allow-network --out results/my-orders
```

The existing [browser case builder](https://blucca.github.io/n8n-check/) works with your connected local slice and finished-input fixture too. [Recorded-results check](verify.mjs): `node examples/amount-sort/verify.mjs` from the repository checkout. `build.mjs` regenerates the supplied six editor controls from that checkout.

## Source and scope

[lowik2005's original report](https://github.com/n8n-io/n8n/issues/43864) describes a 30-item Quickstart workflow on n8n 2.47.7. This pack rebuilds its first three displayed amounts with invented order IDs and customers. The native comparison measures this fixed input; the author's full workflow and their observation about ascending order remain their own task.

The recipe uses JavaScript `Number` for these finite decimal-point amounts, with Sort **1** explicitly retained. [The separate versioned comparator PR](https://github.com/n8n-io/n8n/pull/43895) addresses the upstream node implementation. This pack supplies an existing-node recipe and repeatable complete-output contract.

Need your release's own failing slice repaired? [See the fixed-scope $199 service](../../README.md#paid-help-for-one-failing-workflow).
