# The end check that never runs

An HTTP 200 response containing `[]` can produce **zero n8n items**. An assertion
placed downstream then gets skipped, and the saved execution stays green.

Built for [Ayub Shah's concrete empty-output test](https://community.n8n.io/t/324764):
separate a known missing record from a legitimately empty poll.

## Try the two workflows

This sample uses standard n8n nodes, synthetic records, and a local mock source /
in-memory commit ledger. The fixture covers **zero or one expected record**.

```sh
python3 experiments/zero-output/sink.py
```

Run the mock beside a local n8n process. For a container deployment, set both HTTP
Request URLs to a host address reachable from that container.

Import `original.json` and `fixed.json` into n8n. In the **Expected** node, select
each fixture by replacing its JSON with:

```json
{"case":"normal","expected_count":1,"records":[{"id":"synthetic-A"}]}
```
```json
{"case":"legitimate-empty","expected_count":0,"records":[]}
```
```json
{"case":"silent-loss","expected_count":1,"records":[]}
```

Execute each workflow. The source returns the supplied `records` as a JSON array
with HTTP 200. The expected count is established independently before that call.

## Fixed graph

The source HTTP Request node enables **Include Response Headers and Status**
(`fullResponse: true`). This retains one response envelope with `body: []` even
when the array is empty.

```text
Source envelope → Has records?
  yes → Split body → Commit → Check write receipt → completed / error
  no  → Empty was expected? → legitimately_empty / Stop and Error
```

The empty decision runs **before** splitting the array. Every valid empty run
gets an explicit outcome; a known missing record fails with an `incomplete` reason.

For a real intake, take the expectation from the accepted event or an authoritative
upstream query. For batch writes, reconcile committed **record IDs** using database
`RETURNING` / read-back evidence, then compare that set with the expected IDs.
The local sink here records synthetic mock commits and resets on exit.

## Native results

Tested on **n8n 2.41.7** with three paired fixtures. The automated executions use a
Webhook trigger; the downloadable graphs use a Manual Trigger with the same
fixture and processing nodes. [`results.json`](results.json) keeps every case.

| Fixture | Original saved execution | Original end check | Fixed outcome | Mock writes |
|---|---|---|---|---:|
| expected 1, returned 1 | success | ran | completed / success | 1 |
| expected 0, returned 0 | success | skipped | legitimately_empty / success | 0 |
| expected 1, returned 0 | success | skipped | incomplete / error | 0 |

The original empty cases also return HTTP 500 at the last-node Webhook response
boundary despite the saved execution's `success` status. Fixed legitimate-empty
returns HTTP 200; fixed silent-loss returns HTTP 500 and saved `error`.
