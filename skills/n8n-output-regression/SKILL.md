---
name: n8n-output-regression
description: Run real n8n output regression tests with complete JSON fixtures and expected item counts, ordered IDs, fields or full JSON. Use when a successful workflow loses rows, changes recipients or text, or when preserving output across a workflow edit or version upgrade.
license: MIT
---

# n8n output regression

Turn the intended output into a saved contract, run it on real n8n, and keep the same case when fixing the workflow. This uses the free, AI-led [n8n-check project](https://github.com/blucca/n8n-check).

## 1. Establish the contract

Read the workflow export and the task's expected behavior. Pick:

- A **fixture boundary**: the node whose output is replaced by the complete batch of input JSON objects.
- An **output node**: the executed transformation whose result matters.
- The expected count, ordered IDs/field values, or complete JSON objects. Use the user's requirement or an approved golden result; review exported pins before adopting them as expectations.

Keep every input item in the fixture, including a useful distractor. Request the missing expected behavior when the task leaves it open. For a transformation between external systems, stop after its output; reads and final delivery keep separate integration contracts. Independently reachable sibling branches remain in the slice.

## 2. Choose the execution path

### A. Existing n8n editor — no CLI or Docker setup

Open the [local case builder](https://blucca.github.io/n8n-check/). Import the export, select the fixture boundary and expected-output node, enable **Stop after selected output** where appropriate, and edit the fixture and expectation.

Select **Full JSON items**, **Selected field + item count** (for example `json.id`), or **Item count**. Then **Download editor test (.json)** → import the separate inactive workflow into n8n → **Execute workflow**.

The generated **Check expected output** branch returns `status: "passed"` or throws on a mismatch. Leave it below the tested branch: it runs last, including when zero items skip downstream nodes. Editor tests cover local JSON transforms, v1 execution order, and one incoming connection per node. Merge/loops/waits and HTTP mocks use path B for a self-contained slice. For calls by saved child workflow ID, test a self-contained child/downstream slice; the complete call graph requires its referenced-workflow setup separately. [Five native controls and their actual results](https://github.com/blucca/n8n-check/tree/main/examples/editor-tests).

### B. CLI or CI — saved cases and HTTP request contracts

Requires Node 24+ and an installed n8n CLI for trusted local development. Draft a case from the export's pins:

```sh
npx --yes @blucca/n8n-check@0.1.8 init workflow.json \
  --input "Read invoices" --assert "Prepare notification" \
  --stop-after "Prepare notification" --out workflow.case.json
```

Replace these node names with the selected names from the actual export. Review the draft's readiness messages, edit the fixture/expectation, and retain `version`, `name`, `input`, `mocks`, and `assertions`. `input.items` contains plain JSON objects; the runner wraps them as n8n items.

For a two-invoice task whose required ordered IDs are `INV-42`, `INV-43`, a field-and-count contract is:

```json
{
  "version": 1,
  "name": "Keep both invoice IDs before delivery",
  "input": {
    "node": "Read invoices",
    "items": [
      { "invoiceId": "INV-42", "totalCents": 65000 },
      { "invoiceId": "INV-43", "totalCents": 12050 }
    ]
  },
  "stopAfter": "Prepare notification",
  "mocks": [],
  "assertions": [{
    "node": "Prepare notification",
    "count": 2,
    "pluck": "json.invoiceId",
    "equals": ["INV-42", "INV-43"]
  }]
}
```

Use full-object `equals` for notification text/amounts too; the [complete invoice case](https://github.com/blucca/n8n-check/blob/main/examples/stop-after/case.json) checks both exact messages. Arrays preserve order and duplicates; object-key order is ignored.

Run in your trusted local n8n test environment:

```sh
npx --yes @blucca/n8n-check@0.1.8 workflow.json workflow.case.json \
  --n8n /absolute/path/to/n8n --allow-network \
  --out regression-results --json
```

`--allow-network` selects host networking for this local development path. The [Docker/Action route](https://github.com/blucca/n8n-check#your-first-case) provides network-isolated runs. The runner executes the selected slice with fresh fixture input and cleared output pins. HTTP mocks test the actual Request node's method, body and retry behavior; actual provider state/delivery use separate integration checks.

## 3. Read the result, fix, and rerun

For **test execution** (the `init` command writes a draft and reports its readiness):

- Exit **0**: the contract passed.
- Exit **1**: regression or execution failure; read `checks`, `error`, and the first expected/actual mismatch.
- Exit **2**: setup/configuration error; fix the reported setup before evaluating the output.

Keep the case fixed while editing the workflow. Verify the check is active with one controlled wrong expected ID/count, then restore the approved expectation. For a known regression, rerun the original and repaired exports with the same case. [Both example n8n executions succeed while one drops an invoice](https://github.com/blucca/n8n-check/tree/main/examples/stop-after).

[Author-run command check](example-results.json): runner 0.1.8 / n8n 2.41.7, fixed two-ID output passes; the one-ID regression fails, with both engine executions successful.

Deliver the workflow/test export, reviewed case, actual n8n version, result and first mismatch. CLI writes `report.json` and `junit.xml` under the output directory; keep the report with the case for the next edit or upgrade. State the tested boundary and the integration work remaining.
