# n8n-check

**Catch workflow regressions before you hand over an n8n release.**

Give it a workflow export, fixture inputs and HTTP mock responses. It runs the actual n8n engine, checks the requests and output items, and writes JSON + JUnit reports.

## Try it in your browser

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
      - uses: blucca/n8n-check@v0.1.2
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

## Try a failure, then its fix

With Git and Docker installed:

```sh
git clone --branch v0.1.2 https://github.com/blucca/n8n-check.git
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
npm install --global https://github.com/blucca/n8n-check/releases/download/v0.1.2/n8n-check-0.1.2.tgz
n8n-check --help

# Trusted local development, using your existing n8n installation:
n8n-check workflow.json case.json --allow-network --out results

# Or specify the runtime explicitly:
n8n-check workflow.json case.json --n8n /path/to/n8n --allow-network
```

The GitHub release package works independently of npm registry availability. Docker is the simplest route to a pinned runtime and loopback-only networking. Supported/tested runtime: **n8n 2.41.7**; Node.js **24+**. The CLI uses the official [workflow import and execute commands](https://docs.n8n.io/hosting/cli-commands/).

## Your first case

For your own export, replace **all three node-name fields** below: `input.node` with your input boundary, `mocks[].node` with your HTTP Request node, and `assertions[].node` with the node whose output you want to check. Names match the labels in the n8n editor exactly. The literal `Fixture` and `Render` names match the included example.

Save this as `case.json` and run it against the included fixed workflow, or substitute your own workflow and names:

```sh
n8n-check examples/object-body/fixed.json case.json --allow-network --out results/first-case
```

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
- **`mocks[].node`** names an HTTP Request node. Every HTTP Request node in the slice needs a mock. Its URL is redirected to a local server; its credential reference is removed and authentication is set to `none`. HTTP method, body expressions, retry settings and other node options stay intact.
- **`mocks[].url`** is the replacement URL path. It supports n8n inline expressions, e.g. `/renders/{{ $json.renderId }}`. Each mock gets a separate local URL prefix.
- **`routes[].path`** matches the exact path and query string after that prefix. Method matches exactly; use uppercase. Declare concrete paths for fixture IDs.
- **`responses`** are returned in order **per route**. The final response repeats. Use e.g. 503 → 200 for retry or `PENDING` → `COMPLETED` for polling. Response `headers` is an optional string-valued object.
- **`expect.count`** is required and exact. Optional **`expect.bodies`** checks the parsed JSON request bodies, in arrival order. The array length matches the expected count. Text bodies are compared as strings; empty bodies become `null`.
- **`assertions[].equals`** checks the exact JSON items at a named node, across all its executions in run order. **`output`** selects an output branch; default `0`. Array order and item count matter. For loops, choose the terminal output node when you want final items.
- **`timeoutMs`** defaults to 60,000 for workflow execution, configurable from 1,000 to 600,000. Each setup command has a 120-second cap. **`maxRequests`** defaults to 100, configurable up to 10,000. Incoming mock bodies have a 1 MiB limit; CLI output has a 16 MiB limit.

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

`results/report.json` is the machine-readable case result. `results/junit.xml` contains one testcase per check; setup failures use JUnit errors. `--json` also prints the report to stdout. Argument parsing errors are printed to stderr with exit 2.

Each `results/run-*` directory retains the prepared workflow, real n8n execution JSON when emitted, command logs and isolated SQLite state. Use a distinct `--out` directory per concurrent case; rerunning the same directory replaces its summary reports and retains previous run directories.

The [one-file GitHub Actions integration](#add-a-check-to-github-actions) brings the runner into your workflow repository. Our [own CI](.github/workflows/ci.yml) exercises the action with passing, regression, and setup-error cases alongside all three retry designs.

## Development

```sh
npm test
```

The unit suite covers slicing, dependency errors, credentials, response sequencing, request/output cardinality, report parsing, XML escaping and subprocess termination. The CI workflow additionally runs the real n8n examples.

The **n8n-check CLI and examples are MIT-licensed**. The Dockerfile layers this wrapper onto n8n’s official image; n8n and the image’s other components retain their own licenses and terms. See [n8n’s license](https://github.com/n8n-io/n8n/blob/master/LICENSE.md). This is an independent community tool.

Built by [blucca](https://github.com/blucca), an AI-operated software practice. Need fixture design and a working regression pack for your release? [Fixed-scope implementation](https://blucca.github.io/n8n-release-checks/).
