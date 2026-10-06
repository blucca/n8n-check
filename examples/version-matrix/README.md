# Check the workflow before upgrading n8n

**Keep the workflow and expected behavior fixed. Change the n8n version. Inspect what changes.**

n8n-check's Action accepts `n8n-version`, starting with v0.1.4. A GitHub matrix runs your case against the release you deploy today and the release you want to adopt. Each job produces its own version-labelled summary and JSON/JUnit artifacts.

## Use your own workflow

1. Export the workflow and [build a case](https://blucca.github.io/n8n-check/) with synthetic inputs, HTTP responses, and expected behavior.
2. Copy [`upgrade-check.yml`](upgrade-check.yml) to `.github/workflows/n8n-upgrade.yml` in your repository.
3. Set the two `matrix.n8n` versions and the `workflow` / `case` file paths.
4. Commit and inspect both jobs. `fail-fast: false` preserves the other result when one version fails.

The supplied workflow treats every failed contract as a failed job. Both artifact names include the version, so the reports stay separate. Review a mismatch against your intended behavior before changing the expectation. A failing deployed baseline identifies an existing workflow or engine behavior worth addressing before the upgrade.

The HTTP responses remain controlled local fixtures. Real credentials, provider behavior, triggers, and production data remain separate integration checks. Node types and parameters must exist in each selected n8n release. Data Table initialization adapters in other examples retain their own explicit version bounds.

## A real version difference: a missing PROPFIND body

The author of [n8n #39395](https://github.com/n8n-io/n8n/issues/39395) supplied a Nextcloud workflow on **2.38.4**, where PROPFIND silently drops the request's XML body. Upstream [PR #24151](https://github.com/n8n-io/n8n/pull/24151) adds body handling for this method; **2.41.7** preserves it.

The [workflow and exact-body case](../propfind-body/) use the author's HTTP Request 4.5 parameters and complete 698-character diagnostic XML. The fixture replaces connection information with synthetic values and redirects the URL to a local capture server. This compares the actual released engines with the same export and expected body.

To run the recorded comparison in your fork:

1. Fork n8n-check and enable Actions.
2. Choose **Compare n8n versions on a real PROPFIND regression → Run workflow**.
3. Inspect the contract step summary and download `propfind-n8n-2.38.4` and `propfind-n8n-2.41.7`.

[Comparison workflow source](../../.github/workflows/compare-versions.yml)

This demonstration allows the known older-version contract failure, then asserts the specific missing-body difference. The copyable `upgrade-check.yml` above keeps ordinary strict pass/fail gating for your project.

## Local version selection

```sh
git clone --branch v0.1.4 https://github.com/blucca/n8n-check.git
cd n8n-check
docker build --build-arg N8N_VERSION=2.38.4 -t n8n-check:2.38.4 .
docker run --rm --network none -v "$PWD:/work" n8n-check:2.38.4 \
  examples/propfind-body/workflow.json examples/propfind-body/case.json \
  --out /work/results/2.38.4
# Expected: exit 1, with the request-body assertion failing.
```

Repeat with `2.41.7` for the complete-body contract. Linux users with a UID other than 1000 can add `--user "$(id -u):$(id -g)"` to `docker run`.

Runtime images come from `ghcr.io/n8n-io/n8n`. The default is 2.41.7; supply an exact available release. Every report records the actual `n8nVersion`, `runnerVersion`, and `nodeVersion`.

---

**Have a client upgrade to ship?** The [$650 implementation pilot](https://blucca.github.io/n8n-release-checks/) supplies an agreed fixture pack and handoff for one workflow or slice. Send the deployed version, target version, workflow purpose, and release date to [belgialucca@gmail.com](mailto:belgialucca@gmail.com?subject=n8n%20upgrade%20check).
