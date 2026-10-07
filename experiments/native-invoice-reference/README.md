# Run the native Invoice → HubSpot reference

**Real HubSpot and Slack nodes. Original URLs. Six authored cases, 57 passing checks.**

This experiment runs [James Shannon's shared reference](https://github.com/jamesshannon/n8n-workflow-testing/tree/2298c0aefd72de1d5fbb235cd16d64543fafd16a/workflow-testing/docs/reference/invoice-deal-sync) through the existing HTTP interception hook in **n8n 2.41.7**. James shared the workflow and draft test format for [collaboration in the n8n forum](https://community.n8n.io/t/306721/6). His workflow, six cases, and seven mock bodies are fetched from that fixed source revision.

The experiment is separate from the released n8n-check CLI and Action. It uses version-specific n8n internals to put the proposed format through a real execution.

## Run it

With Docker Linux containers, a shell, and this repository checked out:

```sh
cd experiments/native-invoice-reference
sh run.sh                 # All six original cases; expect exit 0
sh run.sh deal-failure    # First write succeeds, second returns 500; expect exit 0
sh run.sh negative        # Misspelled amount field; expect exit 1
```

The first command downloads the official n8n image and nine public reference files. Later runs use the local `.source/` cache. The workflow container uses `--network none`. Results are written under `results/<mode>/`: `checks.json`, captured `requests.json`, full `run.json`, the case, and runtime metadata. `.source/source.json` records the upstream commit and file hashes.

**Run in your browser:** fork this repository, enable Actions, and run **Try the native invoice reference**. It runs all three modes and uploads the results. [Workflow source](../../.github/workflows/try-native-invoice-reference.yml).

**[Completed GitHub Actions run](https://github.com/blucca/n8n-check/actions/runs/37590485838):** the official Docker image passed all six original cases, the expected-error case, and the negative-control exit check. JSON artifacts are attached to the run.

## Observed results

The table records actual local executions on 2026-10-07. [Full assertions and request captures](observed-results.json) are readable without running the pack.

| Scenario | Engine status | HTTP calls | Contract |
|---|---|---:|---:|
| Eligible invoices | success | 5 | 15/15 |
| Pagination and filter decoys | success | 8 | 16/16 |
| Missing company | success | 4 | 7/7 |
| Empty page | success | 1 | 5/5 |
| Billing 500, then success | success | 6 | 4/4 |
| Billing 500 after all retries | success | 4 | 10/10 |
| Second deal write returns 500 | error | 5 | 13/13 |
| `amount_due` changed to `amountDue` | success | 5 | **13/15; exit 1** |

The added write-failure case captures a partial write: deal 9001 receives its successful PUT, deal 9002 returns 500, and `Audit Log` stays unexecuted. Its expected engine error makes the contract pass. The negative control keeps both correct deal URLs and sends `amount: "NaN"` twice. Exact body assertions catch both values.

### The reference README's four runtime questions

- **Slack channel name:** Slack sends one POST to `https://slack.com/api/chat.postMessage` with `channel: "#billing-alerts"`.
- **Fetch error item:** after three 500 responses, the error output carries the original trigger body and an error. The alert expression reads its message and starts with `Invoice sync failed: Request failed with status code 500`.
- **Merge dotted field:** `properties.domain.value` matches `customer_domain`. The paginated case retains invoices 1001, 1002, and 1006 and sends amounts `1250.00`, `480.00`, and `990.00`.
- **Missing deal ID:** `inv-1005` goes to the Filter's rejected output. The region and currency decoys also leave the accepted path.

## How the experiment works

`run.cjs` reuses n8n's CLI initialization and official JavaScript task runner. It then calls `WorkflowExecute` in `evaluation` mode with:

- `additionalData.evalLlmMockHandler` for HTTP Request, HubSpot, and Slack;
- `EvalMockedCredentialsHelper` for synthetic evaluation credentials;
- declared pins for the webhook input and Postgres output;
- the original workflow's nodes, connections, URL parameters, and auth selections.

Requests are captured at the hook. JSON responses default to `content-type: application/json`, which makes the HTTP Request node's automatic response mode parse the declared bodies. Response headers in the case override that default. A mapping repeats; a list is consumed once per call. Missing mocks and exhausted sequences cause a separate contract failure, including when the workflow handles the error.

The checker evaluates the current reference's `count`, `executed`, `pluck`, ordered calls, subset fields, and expression assertions. Expressions use n8n's own `Expression` engine and its acquired VM context. `$request` is supplied as the proposed assertion variable. Native Error messages are preserved in the saved execution JSON. Failed contracts exit 1 through n8n's command lifecycle.

### Execution scope

This adapter targets this trusted reference and its current draft syntax on n8n 2.41.7. The exact shipped core version is 2.41.5. Webhook delivery and Postgres INSERT behavior sit at the two declared output-pin boundaries. Authentication uses synthetic credentials; service-side behavior comes from the fixtures. Transport timeouts, live credentials, sub-workflow propagation, other spec syntax, and other n8n versions need their own cases and adapter work.

## Source and attribution

James authored the reference workflow, original six cases, mock responses, and design document. They remain in his repository under its terms. The fetch script retains their original bytes and records their source. A separate local copy introduces the amount-field mutation.

The adapter, checker, extra case, and recorded executions were built and reviewed by Blucca's autonomous AI engineering agents (GPT-6 Astra). These original files use this repository's MIT license. n8n and its image retain their own licenses.
