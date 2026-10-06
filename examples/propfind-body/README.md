# Verify PROPFIND sends its XML body after an n8n upgrade

**The reported Nextcloud workflow sends its complete XML body on n8n 2.41.7. Keep that behavior as a repeatable check.**

[KroetschVialutions reported #39395](https://github.com/n8n-io/n8n/issues/39395) with a three-node workflow on n8n 2.38.4 / HTTP Request 4.5: a PROPFIND request silently omitted its raw XML body. The author included an unclosed `<invalid>` element to make a received body visibly fail XML parsing.

Upstream [PR #24151](https://github.com/n8n-io/n8n/pull/24151) added WebDAV-method support. The [2.38.4 implementation](https://github.com/n8n-io/n8n/blob/n8n%402.38.4/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts#L458) restricted raw-body serialization to PATCH/POST/PUT/GET. The [2.41.7 implementation](https://github.com/n8n-io/n8n/blob/n8n%402.41.7/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts#L460) sends a PROPFIND body.

## What this checks

[`workflow.json`](workflow.json) comes from the author's public reproduction. Its HTTP Request parameters, node version and diagnostic XML are preserved. Instance metadata is removed and node IDs are replaced with local labels. The Code-node fixture supplies synthetic values; n8n-check redirects the HTTP URL to a local mock.

[`case.json`](case.json) checks:

- Exactly **one PROPFIND request** to the mock route.
- The **complete 698-character XML body**, including newlines and the author's diagnostic marker.
- The HTTP Request node's exact output from the declared JSON mock response.

The real n8n engine executes the HTTP node. This is an **HTTP transmission contract**: the mock captures the body and returns a declared response. Nextcloud authentication, XML parsing, requested properties and live instance behavior have their own integration checks. Remove the deliberate `<invalid>` marker when testing a real property query; update the case's expected body when changing the XML.

## Run the upgrade check

This example lives on **`main`**. Clone the current repository to get these files; the released v0.1.2 runner can execute them.

With Git and Docker:

```sh
git clone --branch main https://github.com/blucca/n8n-check.git
cd n8n-check
docker build -t n8n-check .

docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/propfind-body/workflow.json examples/propfind-body/case.json \
  --out /work/results/propfind
# PASSED ... n8n 2.41.7; 6 checks; exit 0
```

On Linux, add `--user "$(id -u):$(id -g)"` when your user ID differs from the image's default 1000. Windows users can run these commands in WSL.

The Dockerfile pins n8n 2.41.7. The container uses loopback-only networking; fixture values replace the input Code node and all HTTP traffic goes to the local mock. Reports appear in `results/propfind/report.json` and `junit.xml`.

### Check your own export and installed runtime

From this repository checkout, with the [CLI installed](../../README.md#install-the-cli-from-github):

```sh
n8n-check /path/to/nextcloud-export.json examples/propfind-body/case.json \
  --n8n /path/to/n8n --allow-network --out results/propfind-local
```

Use the same `Code in JavaScript` input boundary and `HTTP Request` node names, or update those names in the case. This case expects the diagnostic XML from the report verbatim. `--n8n` selects the installed runtime you want to verify; its version is recorded in the report. `--allow-network` selects trusted local execution on the host; the declared HTTP mock still captures this request locally. The Docker command above provides network isolation.

## Confirm the test catches a missing body

[`no-body-control.json`](no-body-control.json) changes exactly one HTTP parameter: `sendBody` becomes `false`. It is an intentional negative control using the same n8n version.

```sh
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/propfind-body/no-body-control.json examples/propfind-body/case.json \
  --out /work/results/propfind-no-body
# FAILED ... exact body: expected XML, actual null; exit 1
```

The workflow execution itself still succeeds. The request-body assertion detects the omitted business payload.

## Recorded results

[Observed JSON](observed-results.json) includes the original-export independent run and runs of both published exports, with versions, exact request bodies and check results. These runs used n8n-check 0.1.2, n8n 2.41.7 and a Linux namespace with only the loopback interface.

| Workflow | n8n execution | Requests | XML body | Check |
|---|---|---|---|---|
| Reported parameters | Success | 1 PROPFIND | All 698 characters | 6/6, exit 0 |
| `sendBody=false` control | Success | 1 PROPFIND | Empty (`null`) | Body assertion fails, exit 1 |

The published fixture and recorded results are maintained by [blucca](https://github.com/blucca), an AI-operated software practice. Original reproduction credit: [KroetschVialutions, n8n #39395](https://github.com/n8n-io/n8n/issues/39395).
