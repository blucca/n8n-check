# Preserve every Article in an Agregado batch

A regression pack for a real maintained workflow: [ffrt-labs/agregado](https://github.com/ffrt-labs/agregado), a personal content pipeline whose Miniflux webhook delivers multiple Articles at once.

`Parse entries` emits one item per Article. The original downstream Code nodes run once for all items, read `$input.first()`, and return one item. With two ordinary Articles, the engine succeeds and only the first Article reaches the Enrichment API.

The proposed patch adds **Loop Articles, batch size 1**, ahead of those single-Article nodes. A successful API call advances the loop. The existing backoff stays on the current Article; terminal failure keeps the alert-and-stop path, leaving the remaining Articles for operator replay.

## Recorded real-engine results

Executed October 7, 2026 (Asia/Shanghai), with **n8n 2.41.7**, Node.js 26.10.0, and n8n-check 0.1.3 from the repository checkout. Inputs, environment values and HTTP responses are synthetic; the downstream Code, If, HTTP Request, Loop and Wait nodes execute in the actual engine.

| Workflow / case | Enrichment POST Article IDs | D1 content reads | Check result |
|---|---|---:|---|
| Original, two ordinary Articles | `101` | 0 | **FAIL**, exit 1; engine succeeds |
| Patch, two ordinary Articles | `101, 102` | 0 | **PASS**, 9/9 |
| Patch, ordinary / Bridge / ordinary / Bridge | `101, 102, 103, 104` | 2 | **PASS**, 9/9 |
| Patch, Article 102 gets one 503 then 200 | `101, 102, 102` | 0 | **PASS**, 9/9 |

The mixed case checks each Article's complete request body, including its own `bridge_content`. The retry case checks that Article 101 stays at one request while Article 102 retries with its own body. All three successful patched runs reached Loop's Done output with the expected number of completions.

[Observed request bodies and checks](observed-results.json) · [Proposed source patch](https://github.com/blucca/agregado/commit/b4e4332b57341f1afdb7a3be7a9069540b8a15f4)

## Reproduce with Docker

From an n8n-check **main** checkout, with Node.js 24+, curl, Git and Docker:

```sh
git clone https://github.com/blucca/n8n-check.git
cd n8n-check
node examples/agregado-enrichment/prepare.mjs
docker build -t n8n-check .

# The original must produce exit 1: two Articles in, one Enrichment POST out.
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD:/work" n8n-check \
  temp/agregado-enrichment/original.json \
  temp/agregado-enrichment/ordinary.case.json \
  --n8n /work/examples/agregado-enrichment/n8n-synthetic \
  --out /work/temp/agregado-enrichment/results/original

# All three patched cases must produce exit 0.
for scenario in ordinary mixed retry; do
  docker run --rm --network none --user "$(id -u):$(id -g)" \
    -v "$PWD:/work" n8n-check \
    temp/agregado-enrichment/fixed.json \
    "temp/agregado-enrichment/$scenario.case.json" \
    --n8n /work/examples/agregado-enrichment/n8n-synthetic \
    --out "/work/temp/agregado-enrichment/results/$scenario" || break
done
```

`prepare.mjs` downloads and parses the original and patched exports at immutable Git commits, then writes three case files. Generated files and JSON/JUnit reports stay under `temp/agregado-enrichment/`. Windows users can run the shell commands in WSL.

For a local n8n installation, put its executable on `PATH` and point `--n8n` to the **absolute path** of `examples/agregado-enrichment/n8n-synthetic`. Run in a loopback-only Linux network namespace, or explicitly select `--allow-network` for trusted local development.

## What the check exercises

- Fixture input replaces `Parse entries`; all reachable downstream nodes retain their source parameters and connections.
- Four HTTP nodes use declared loopback mocks. The Enrichment endpoint receives exact-body assertions; the D1 and alert paths have exact request counts.
- `n8n-synthetic` enables the source project's required `crypto` builtin and Code-node environment access, then supplies a fixed synthetic environment. The n8n-check subprocess still starts with its fresh environment, home and database.
- The recorded scope starts after webhook/signature parsing. Live Miniflux delivery, Cloudflare credentials, the real Enrichment service, sustained failure/retry exhaustion and terminal-error alert delivery have separate acceptance paths.

## Source and attribution

Original workflow: **ffrt-labs/agregado**, commit `0cbbac9c7c6e19f2b9f82bab57cf75a171279eac`, `n8n/workflows/article-enrichment.json`. Its [README declares MIT](https://github.com/ffrt-labs/agregado/blob/0cbbac9c7c6e19f2b9f82bab57cf75a171279eac/README.md#license). The source export is downloaded intact, and its hash is recorded in `prepare.mjs` and generated `sources.json`.

Proposed patch: **blucca/agregado**, commit `b4e4332b57341f1afdb7a3be7a9069540b8a15f4`. The patch includes a native graph regression test and regenerated export. These synthetic contracts and the runner are maintained by blucca, an AI-operated software practice.
