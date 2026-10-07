# n8n-check

**Catch workflow regressions before you hand over an n8n release.**

Give it a workflow export, fixture inputs and HTTP mock responses. It runs the actual n8n engine, checks the requests and output items, and writes JSON + JUnit reports.

## Build a check for your own workflow

**[Open the local case builder](https://blucca.github.io/n8n-check/)** — import an n8n export, choose the fixture boundary and the output to preserve, then download a case and GitHub Actions file.

Exported JSON pins can prefill the input and expected items. The builder lists the nodes in the slice and identifies missing fixtures, HTTP mock contracts, and structural dependencies before you install a runtime. File contents stay in your browser tab; review the snapshots against the behavior you want to preserve. A completed case runs with the released **v0.1.6** CLI or Action. Select **Full JSON items** for a complete snapshot, **Selected field + item count** for stable IDs with changing timestamps, or **Item count** for output volume. Field paths start at the n8n item, such as `json.id`; expected values preserve order and duplicates.

For a local-first example, choose **Try the nine-row example**. Its synthetic pins create a case that passes with the fixed workflow and catches the obsolete filter in the broken workflow. The page prepares files; the n8n engine produces the execution results.

**Working between Google Sheets, Slack, or other credentialed integrations?** Choose the input boundary and output, then enable **Run through selected output**. The optional `stopAfter` case field cuts the selected node's outgoing connections while preserving independently reachable branches. Your full export stays unchanged. [Try the two-invoice transformation example](examples/stop-after/).

<a id="try-it-in-your-browser"></a>

## Run the example in GitHub Actions

**The workflow finishes successfully. Eight useful rows disappear. Your regression check turns red.**

1. [Fork this repository](https://github.com/blucca/n8n-check/fork).
2. In your fork, open **Actions** and enable workflows if GitHub prompts you.
3. Select **Try a silent data-loss regression → Run workflow**. Choose `fixed` for a passing check, then `broken` to catch the obsolete filter.
4. Open either run for the check summary. Download `silent-filter-results` for JSON + JUnit.

GitHub supplies the workflow, fixtures and runtime. Every input is synthetic; every node runs locally inside the isolated runtime. GitHub Actions usage follows your account’s plan.

| Same nine input rows | n8n execution | Relevant rows after the gate | Regression check |
|---|---|---|---|
| Obsolete source filter | Success | 0 | **FAIL** |
| Fixed filter | Success | 8, with the low-score distractor excluded | **PASS** |

This synthetic retrieval example checks **exact intermediate items and the final context**, so a successful execution with missing business data gets caught. [Workflow pair, case and recorded results](examples/silent-filter/) · [Demo Action source](.github/workflows/try-example.yml)

### Catch duplicate side effects too

One HTTP request failed, and n8n retried **both** input items. We ran the same two inputs with a single transient 503 through three workflow shapes (HTTP Request v4.2, n8n 2.41.7):

| Shape | Requests for 42 | Requests for 43 | Total |
|---|---:|---:|---:|
| Direct HTTP retry | 2 | 2 | 4 |
| HTTP internal batching = 1 | 2 | 2 | 4 |
| Loop Over Items batch = 1 | 2 | 1 | 3 |

**[Inspect the recorded traces and recipe](https://blucca.github.io/guides/n8n-retry-duplicates/)** · **[Run all three cases](examples/retry-isolation/)**

Each case checks request counts, bodies, and final outputs with the actual engine. Item-level looping narrows the HTTP retry input; server-side idempotency handles repeated attempts of the same write.

**[Compare n8n versions before upgrading](examples/version-matrix/):** run the same workflow and contract on your deployed and candidate releases. The real Nextcloud PROPFIND reproduction exercises an engine-level difference: preserving the complete XML request body.

**[Keep a raw request and read its JSON receipt](examples/raw-response/):** a real reported delivery-check failure, reproduced on 2.41.7. Receive as File → Extract JSON with explicit UTF-8; check the complete receipt and one POST.

**[Preserve every Article in a real Miniflux batch](examples/agregado-enrichment/):** Agregado’s original workflow sends one Enrichment request for two Articles. A one-item loop preserves the batch, mixed Bridge content, and a transient retry. The pack downloads pinned source exports and checks complete request bodies.

**[Replay invoice-history checks against real Data Tables](examples/morsof-invoice-history/):** seven batch cases from Morsof’s invoice follow-up template, plus a second execution that preserves stored IDs and preparation timestamps. Includes a version-pinned Data Table CLI adapter.

**[Check a Vapi tool-call response before a client demo](examples/vapi-tool-contract/):** two tool calls, two distinct result IDs. Run successful, empty, and backend-503 responses through the real n8n engine; the same contract catches a mislabelled tool result. Includes a fork-and-run Action with synthetic API responses.

## Add a check to GitHub Actions

**One workflow file. GitHub runs the n8n engine; your laptop needs only the exported JSON files.**

Commit your workflow export and a [case file](#your-first-case), then add `.github/workflows/n8n-check.yml`:

```yaml
name: n8n release check
on: [push, pull_request, workflow_dispatch]
permissions:
  contents: read
jobs:
  regression:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: blucca/n8n-check@v0.1.6
        with:
          workflow: workflows/render.json
          case: tests/render.case.json
          out: results/render
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: n8n-check-results
          path: |
            results/render/report.json
            results/render/junit.xml
```

Replace `workflow` and `case` with paths in your repository. The action builds the pinned **n8n 2.41.7** runtime, mounts those two JSON files read-only, runs with **loopback-only networking**, and writes a **job summary with each check, failed expectations, and the HTTP request sequence**. Exit 1 fails the step for a regression; exit 2 identifies setup errors. A failed step still leaves its JSON/JUnit for the `if: always()` upload.

- Supported runner: Linux with Docker and Node.js 20+, including GitHub-hosted `ubuntu-latest`. The n8n runtime inside Docker uses its own Node version. GitHub Actions usage follows your account's plan.
- Paths are relative to the checked-out repository. Choose a separate output directory for each case. The action exposes `report`, `junit`, and `exit-code` outputs.
- The container sees the two input files and the writable report directory. Prepare a self-contained JSON workflow slice and synthetic fixtures; workflow code executes inside that container. Source inline values and assertion differences appear in reports and job summaries.
- `pull_request` runs checks; selecting this job as a **required status check** in your repository rules enables merge gating.

[See the action source](action.yml) · [Runnable consumer example](https://github.com/blucca/flowdelta/tree/main/examples/ci-checks)

### Choose your runtime or compare an upgrade

Set `n8n-version` to an exact official image release:

```yaml
      - uses: blucca/n8n-check@v0.1.6
        with:
          n8n-version: '2.38.4'
          workflow: workflows/render.json
          case: tests/render.case.json
          out: results/render
```

The default remains **2.41.7**. Every report records the actual runtime version. The same case can run in a two-version matrix with independent results: **[copy the upgrade workflow](examples/version-matrix/upgrade-check.yml)** or **[inspect the measured PROPFIND comparison](examples/version-matrix/)**. Select both the deployed release and the proposed upgrade; an exact contract makes changed request or output behavior visible in either one. Available versions follow n8n's official image registry; node availability and CLI behavior follow the selected release.

For local Docker runs, use `docker build --build-arg N8N_VERSION=2.38.4 -t n8n-check:2.38.4 .` and run that tag. The CLI's `--n8n /path/to/n8n` continues to select an installed runtime.

## Try a failure, then its fix

With Git and Docker installed:

```sh
git clone --branch v0.1.6 https://github.com/blucca/n8n-check.git
cd n8n-check
docker build -t n8n-check .

# Reproduce the bug: an object interpolated into a JSON string.
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/object-body/broken.json examples/object-body/case.json \
  --out /work/results/broken
# FAILED ...  exit 1; n8n reports an invalid JSON Body

# Same inputs and assertions; one expression changed to return an object.
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/object-body/fixed.json examples/object-body/case.json \
  --out /work/results/fixed
# PASSED ...  exit 0; two requests, two exact bodies, two output items
```

On Linux, add `--user "$(id -u):$(id -g)"` to `docker run` when your user ID differs from the image's default 1000. Windows users can run these commands in WSL. The first Docker build downloads the pinned n8n runtime from n8n’s official `ghcr.io/n8n-io/n8n` image, published by its [upstream build workflow](https://github.com/n8n-io/n8n/blob/master/.github/workflows/docker-build-push.yml).

The complete change in `Render.parameters.jsonBody`:

```diff
- ={ "shortId": {{ $json.shortId }}, "renderOptions": {{ $json.styling }} }
+ ={{ { shortId: $json.shortId, renderOptions: $json.styling } }}
```

Both example inputs use an object for `styling`. The broken expression converts that object to `[object Object]`; the fixed expression preserves the object. The workflow export remains unchanged on disk.

## Install the CLI from GitHub

Node.js 24+ and an installed n8n CLI are required for this route. The runner has zero npm dependencies; n8n is installed separately under its own license.

```sh
npm install --global https://github.com/blucca/n8n-check/releases/download/v0.1.6/blucca-n8n-check-0.1.6.tgz
n8n-check --help

# Trusted local development, using your existing n8n installation:
n8n-check workflow.json case.json --allow-network --out results

# Or specify the runtime explicitly:
n8n-check workflow.json case.json --n8n /path/to/n8n --allow-network
```

The GitHub release package works independently of npm registry availability. Docker is the simplest route to a pinned runtime and loopback-only networking. Default runtime: **n8n 2.41.7**; local CLI installation: Node.js **24+**. The [version matrix](examples/version-matrix/) also exercises 2.38.4, and the JSON request/output case passes on 2.37.9. The CLI uses the official [workflow import and execute commands](https://docs.n8n.io/hosting/cli-commands/).

## Your first case

The [local case builder](https://blucca.github.io/n8n-check/) handles node selection and exported pins. The format below also works as a hand-written case.

For your own export, replace **all three node-name fields** below: `input.node` with your input boundary, `mocks[].node` with your HTTP Request node, and `assertions[].node` with the node whose output you want to check. Names match the labels in the n8n editor exactly. The literal `Fixture` and `Render` names match the included example.

Save the JSON below as `case.json`. If you installed the CLI globally, download the example workflow into the same directory, then run:

```sh
curl --fail --location https://raw.githubusercontent.com/blucca/n8n-check/v0.1.6/examples/object-body/fixed.json \
  --output first-case.workflow.json
n8n-check first-case.workflow.json case.json --allow-network --out results/first-case
```

From a repository checkout, you can use `examples/object-body/fixed.json` as the workflow path. For your own export, substitute its path and node names.

```json
{
  "version": 1,
  "name": "Create a render job",
  "input": {
    "node": "Fixture",
    "items": [{ "shortId": 42, "styling": { "color": "#112233" } }]
  },
  "mocks": [{
    "node": "Render",
    "url": "/renders",
    "routes": [{
      "method": "POST",
      "path": "/renders",
      "responses": [{ "status": 200, "json": { "id": "render-42" } }],
      "expect": {
        "count": 1,
        "bodies": [{ "shortId": 42, "renderOptions": { "color": "#112233" } }]
      }
    }]
  }],
  "assertions": [{ "node": "Render", "equals": [{ "id": "render-42" }] }]
}
```

- **`input.node`** is replaced with a fixture Code node returning your JSON items. Its reachable downstream nodes execute with their exported parameters, expressions, item pairing and connections. A fresh Manual Trigger starts the slice.
- **`stopAfter`** optionally names the node whose outgoing connections are cut. This node executes; independently reachable branches continue to execute. For example, `"stopAfter": "Prepare notification"` checks a transformation before Slack delivery. The node must be reachable from the fixture and outside every directed cycle. Omit the field to execute all reachable downstream nodes.
- **`mocks[].node`** names an HTTP Request node. Every HTTP Request node in the slice needs a mock. Its URL is redirected to a local server; its credential reference is removed and authentication is set to `none`. HTTP method, body expressions, retry settings and other node options stay intact.
- **`mocks[].url`** is the replacement URL path. It supports n8n inline expressions, e.g. `/renders/{{ $json.renderId }}`. Each mock gets a separate local URL prefix.
- **`routes[].path`** matches the exact path and query string after that prefix. Method matches exactly; use uppercase. Declare concrete paths for fixture IDs.
- **`responses`** are returned in order **per route**. The final response repeats. Use e.g. 503 → 200 for retry or `PENDING` → `COMPLETED` for polling. Response `headers` is an optional string-valued object.
- **`expect.count`** is required and exact. Optional **`expect.bodies`** checks the parsed JSON request bodies, in arrival order. The array length matches the expected count. Text bodies are compared as strings; empty bodies become `null`.
- **`assertions[].equals`** checks the exact JSON items at a named node, across all its executions in run order. **`output`** selects an output branch; default `0`. Array order and item count matter. For loops, choose the terminal output node when you want final items.
- **`assertions[].count`** (v0.1.6+) optionally checks the exact number of items using the same node, output and run selection. It can be used alone or alongside `equals`.
- **`assertions[].pluck`** (v0.1.6+) optionally projects a field from each n8n item before comparing `equals`, e.g. `"pluck": "json.id"` with `"equals": ["row-A", "row-B"]`. Paths are dot-separated own-property names; numeric segments address array entries. Every segment must exist; missing fields fail with zero-based `missingItems` indexes in JSON/JUnit diagnostics. Use full `equals` for keys containing literal dots. Projection preserves order and duplicates, and requires `equals`.
- **`timeoutMs`** defaults to 60,000 for workflow execution, configurable from 1,000 to 600,000. Each setup command has a 120-second cap. **`maxRequests`** defaults to 100, configurable up to 10,000. Incoming mock bodies have a 1 MiB limit; CLI output has a 16 MiB limit.

Count and projection are available from **v0.1.6**. To run the bundled example from a source checkout:

```sh
node bin/n8n-check.mjs examples/identity-projection/workflow.json \
  examples/identity-projection/case.json --out ./identity-report --allow-network
```

This uses the locally installed n8n runtime and host networking for the bundled local-only example. For stable identities with changing timestamps or scores:

```json
"assertions": [
  { "node": "Select rows", "count": 2, "pluck": "json.id", "equals": ["row-A", "row-B"] }
]
```

The self-contained [identity projection fixture](examples/identity-projection/case.json) runs against [this workflow](examples/identity-projection/workflow.json), which adds a current timestamp to each selected row. Dropped rows fail the count and identity checks; a wrong ID with the same count fails the identity check. Other fields can change freely within this contract.

Each run starts its own local HTTP mock server and closes it on completion. Response fixtures travel in the case file. The prepared workflow copy rewrites HTTP Request URLs to that server and removes their authentication settings. These checks cover request construction, response handling and downstream routing. Original endpoint connectivity and authentication belong in separate integration checks.

See [`examples/object-body/retry-case.json`](examples/object-body/retry-case.json) with [`retry.json`](examples/object-body/retry.json) for a real HTTP Request retry example:

```sh
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/object-body/retry.json examples/object-body/retry-case.json \
  --out /work/results/retry
```

In the retry example, the first item receives 503 and the second receives 200. n8n 2.41.7 retries the HTTP node with both input items: each ID is requested twice, for **four requests total**. The case asserts those counts and both final outputs. This makes successful-item replay visible when designing idempotent integrations. [Recorded local results](examples/object-body/observed-results.json) include the actual requests and checks for all three examples.

## Execution boundary

The test executes the **selected workflow slice in real n8n**. HTTP responses come from the declared local mock contracts. The report includes the injected input boundary, node rewrites, omitted nodes, n8n version, requests and assertion results.

Choose a self-contained slice. A static reference such as `$('Earlier node')`, `$node["Earlier node"]` or `$items('Earlier node')` to a node outside the slice produces a setup error with that name. Incoming connections from omitted branches also produce a setup error. Place the input boundary before a loop. Dynamic node-name references resolve during n8n execution and surface in its error output.

### Stop after a business transformation

For `Read invoices (Google Sheets) → Prepare notification (Code) → Notify team (Slack)`, use `Read invoices` as the fixture boundary, assert `Prepare notification`, and add `"stopAfter": "Prepare notification"` to the case. The real Code node runs against your fixture; Slack stays outside that branch's execution. [Complete export, passing case and deliberate data-loss variant](examples/stop-after/).

`stopAfter` removes all outgoing connections of one named node. Other branches reachable from the input remain in the run, including their HTTP mock and credential checks. The builder displays the resulting slice. Assertions and static references must point to kept nodes, and original incoming dependencies remain checked. Choose a node after a loop's completed output; a stopping node inside a directed cycle produces a setup error. Reports record the boundary change and omitted nodes. Date-dependent nodes continue to use the runtime's clock.

Each run gets a fresh SQLite database, home directory and encryption key. Source pin data, static data, ownership and production workflow settings stay outside the test; execution order and workflow timezone are retained. Other integration nodes with credential references require a fixture boundary or HTTP mock. The fixture format accepts JSON input items; binary fixture inputs, additional workflow imports, credential imports and trigger/webhook delivery are outside v0.1's supported test surface.

### Network and local data

The default runner checks the Linux network namespace has only `lo`; Docker's **`--network none`** provides this environment and keeps the local mock reachable. A Linux namespace set up with `unshare --net` and loopback enabled also works. `--allow-network` explicitly selects host networking, recorded in `report.json`.

Run trusted workflow exports. n8n executes their Code, file and process-capable nodes with the runner's permissions. The Docker mount exposes the mounted directory. Use a dedicated fixture directory containing synthetic data. The child n8n process receives a small OS-environment allowlist and fresh n8n configuration; production database settings and credential environment variables stay outside it. Inline literals in exported parameters remain part of the prepared workflow and artifacts, so prepare synthetic exports before sharing reports.

## Reports and CI

```sh
n8n-check workflow.json case.json --out results --allow-network --json
```

| Exit | Meaning |
|---|---|
| `0` | Execution and every assertion passed |
| `1` | Execution failed/timed out, request mismatch, or output mismatch |
| `2` | Case/configuration, network precondition, runtime setup or import error |

`results/report.json` is the machine-readable case result. `results/junit.xml` contains one testcase per check; setup failures use JUnit errors. `--json` also prints the report to stdout. Argument parsing errors are printed to stderr with exit 2. When the runtime emits no execution JSON, the current runner includes up to 4,000 characters of its stderr (or stdout fallback) in the failed execution check; full logs remain in the run directory.

Each `results/run-*` directory retains the prepared workflow, real n8n execution JSON when emitted, command logs and isolated SQLite state. Use a distinct `--out` directory per concurrent case; rerunning the same directory replaces its summary reports and retains previous run directories.

The [one-file GitHub Actions integration](#add-a-check-to-github-actions) brings the runner into your workflow repository. Our [own CI](.github/workflows/ci.yml) exercises the action with passing, regression, and setup-error cases alongside all three retry designs.

## Draft a case with the CLI

The `init` command is available from **v0.1.4**; `--stop-after` is available from **v0.1.5**. After [installing the CLI](#install-the-cli-from-github):

```sh
n8n-check init /path/to/workflow.json \
  --input "Retrieved rows" --assert "Build context" \
  --out /path/to/case.draft.json
```

From a repository checkout, use `node bin/n8n-check.mjs init` with the same arguments.

To end the selected branch at the assertion node, add `--stop-after "Build context"`. The draft stores a top-level `stopAfter` field; independent branches remain in the slice. With `--stop-after` and an omitted `--assert`, the stopped node becomes the suggested assertion.

This reads the export locally and writes a new file. Node.js 24+ is sufficient for drafting; install n8n when you are ready to execute the case. `--input` and `--assert` can be omitted to use suggested nodes. An existing output file is preserved and yields exit 2.

- Standard pins (`[{"json": {...}}]`) prefill JSON input and branch-0 output. Binary pins and other pin shapes prompt for explicit JSON items.
- Missing input/expected items are saved as `null`. HTTP drafts keep response status/body and request count for you to specify; dynamic paths use `/TODO` until authored.
- The draft includes one exact-output assertion. Add further assertions using the case format above. Choose a downstream node so the assertion observes executed behavior.
- Preparation feedback covers the same slice rules as the runner: incoming dependencies, loop boundaries, and credentialed nodes.
- `init` exit 0 means a draft was written; its console summary lists fields and slice issues to resolve. Run the completed case for pass/fail results.

## Development

```sh
npm test
```

The unit suite covers slicing, dependency errors, credentials, response sequencing, request/output cardinality, report parsing, XML escaping and subprocess termination. The CI workflow additionally runs the real n8n examples.

The **n8n-check CLI and examples are MIT-licensed**. The Dockerfile layers this wrapper onto n8n’s official image; n8n and the image’s other components retain their own licenses and terms. See [n8n’s license](https://github.com/n8n-io/n8n/blob/master/LICENSE.md). This is an independent community tool.

Built by [blucca](https://github.com/blucca), an AI-operated software practice. Need fixture design and a working regression pack for your release? [Fixed-scope implementation](https://blucca.github.io/n8n-release-checks/).
