# Vapi tool calls: preserve the caller, surface the backend failure

**Two tool calls in one request. Two different customers. Every response keeps its own `toolCallId`.**

This synthetic backend check looks up customer orders through a real n8n HTTP Request node. It checks outgoing customer/ID pairs, response serialization, and the complete Vapi `results` envelope.

| Scenario | Backend responses | Expected tool response |
| --- | --- | --- |
| `success` | Two HTTP 200 responses with different orders | Two distinct IDs and the correct serialized order data |
| `backend-503` | Customer A succeeds; customer B returns 503 | A retains its result; B receives an explicit `error` string |
| `empty-orders` | Customer B returns `{"orders":[]}` | B receives the successful string `"{\"orders\":[]}"` |
| `wrong-id.json` with the unchanged success case | Both backend requests succeed | **FAIL**: the second result incorrectly repeats the first tool-call ID |

## The workflow

`Vapi webhook → Split tool calls → Lookup orders → Build Vapi response → Respond to Vapi`

- [`workflow.json`](workflow.json) is an importable synthetic workflow with a Webhook input and Respond to Webhook configured for HTTP 200.
- Each case injects the Webhook node's `body.message` JSON and stops after **Build Vapi response**. The real Split, HTTP Request, and response-building nodes execute; the fixture replaces webhook delivery and the response node sits beyond this test boundary.
- HTTP Request uses **Include Response Headers and Status** and **Never Error** to preserve the backend's status for response mapping. Local HTTP mocks return the declared 200/503 responses.
- Response construction follows n8n item pairing back to each split tool call. Each route checks exactly one request and its exact customer/`toolCallId` body.
- Success uses `JSON.stringify` for a single-line `result`. HTTP 503 maps to `error`, preserving the sibling success. Empty order data stays an explicit successful result.

## Run from your browser

1. [Fork n8n-check](https://github.com/blucca/n8n-check/fork), then enable **Actions** in your fork.
2. Open **Try a Vapi tool-call contract → Run workflow**.
3. Choose `backend-503` with `workflow` to check a successful result beside an explicit tool error. Choose `success` with `wrong-id` to see the regression turn the job red.
4. Read the check summary; download `vapi-tool-contract-results` for JSON/JUnit.

This Action runs the selected case with the released **v0.1.7** runner and **n8n 2.41.7**, using loopback-only Docker networking and synthetic data. GitHub Actions usage follows your account plan. [Action source](../../.github/workflows/try-vapi-tool-contract.yml).

## Run with real n8n

From the repository root, with Node.js 24+ and n8n installed:

```sh
# Optional: select an existing installation.
# export N8N_BINARY=/absolute/path/to/n8n
for scenario in success backend-503 empty-orders; do
  node bin/n8n-check.mjs examples/vapi-tool-contract/workflow.json \
    "examples/vapi-tool-contract/$scenario.case.json" \
    --allow-network --out "temp/vapi-tool-contract/$scenario" || exit $?
done

# Negative control: expect exit 1 and a failed Build Vapi response assertion.
node bin/n8n-check.mjs examples/vapi-tool-contract/wrong-id.json \
  examples/vapi-tool-contract/success.case.json \
  --allow-network --out temp/vapi-tool-contract/wrong-id
```

The bundled source and fixtures use synthetic values. The local command enables host networking; the runner redirects both HTTP routes to its loopback mock. Use the repository's [Docker route](../../README.md#try-a-failure-then-its-fix) for an isolated runtime. Run local CLI cases sequentially: n8n's task broker uses a shared default port.

Recorded execution: **n8n 2.41.7, n8n-check 0.1.6**, three passing cases, each with eight checks and two HTTP requests. The wrong-ID control retains successful execution and both correct backend requests while failing the output assertion. [`observed-results.json`](observed-results.json) contains compact check results, mock traces, and the actual emitted envelopes.

**[Completed GitHub Actions run](https://github.com/blucca/n8n-check/actions/runs/37558788945):** `backend-503`, 8/8 checks, two HTTP requests, loopback-only networking. The result preserves customer A’s order and returns customer B’s tool error.

## Verified Vapi contract and scope

Official references, read 2026-10-07:

- [Custom tools — request and response format](https://docs.vapi.ai/tools/custom-tools): `message.toolCallList[].function.name` and object-valued `function.arguments`; `results[]` associates each response with `toolCallId`; `result` and `error` are single-line strings. Each entry uses one of those fields. Multiple results may appear in any order. The server returns HTTP 200 for successful and tool-error envelopes.
- [Server URL events — tool calls](https://docs.vapi.ai/server-url/events): documents tool-call delivery and response correlation. Its introductory flattened `name`/`parameters` example is a separate input shape; this fixture follows the custom-tools function/arguments example above.

This pack covers one tool, `lookupOrders`, a non-empty batch with unique call IDs, object-valued arguments, synthetic customer IDs, and backend HTTP responses containing JSON. The assertions preserve this sample's response order as well as the Vapi ID mapping. HTTP error handling here covers returned statuses; transport timeouts/DNS errors, malformed tool arguments, webhook authentication/delivery, and actual HTTP 200 response delivery require additional integration cases. The sample's Webhook response configuration is supplied for importing and subsequent endpoint testing.

Voice/audio, Twilio delivery, ElevenLabs speech, model decisions, live Vapi acceptance, and production credentials are separate live-agent acceptance work. A buyer's export, tool schema, example call trace, and agreed behavior provide the next test inputs.
