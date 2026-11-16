# Hosted action-count experiment

`web/usage.mjs` is the single action-label allowlist. The builder and saved-call inspector send only `event`, `source` (`page`, `example`, `import`) and a random per-page `session`. Each event/source pair is sent once in that page lifetime. The source describes how files entered the UI; imported files may also be synthetic examples.

The official hosted pages honor `?usage=off`, Do Not Track and Global Privacy Control. The event request omits credentials and the referrer. File contents remain local. Counts are preparation/download observations; users run checks in their own n8n.

The optional collector is a Node standard-library HTTP server:

```sh
USAGE_LOG=/path/to/private/events.jsonl \
USAGE_EXPIRES=2026-11-24T01:00:00Z \
PORT=17630 node ops/usage-server.mjs
```

Use an existing private directory for the log. The collector serves `GET /health` and accepts the fixed three-field protocol at `POST /event` from `https://blucca.github.io`. It appends only action labels, the page ID and UTC time. Requests after the fixed expiry receive 410. The client runs its normal local tools while the collector is unavailable.

The two-file check is `node --test test/usage.test.mjs`; the existing web test covers the unchanged expected-output editing path. When this experiment ends, remove the client imports and footer notice, and stop its collector/tunnel. The runtime checker, CLI and editor-test generation are independent of these counts.
