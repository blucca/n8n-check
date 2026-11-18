# A workflow handoff your teammate can rerun

Keep your existing owner, trigger and connection notes. Add one executable acceptance case: a fixed input, an independently approved business answer, and a teammate’s run receipt tied to the workflow release.

## Make the first run checkable

Ask the business owner for a concrete input payload and its expected result, based on a business rule or independently prepared records. Choose exact JSON, item count, or ordered field values plus count. Review prefilled pins against that answer, then keep the input and expectation together in `case.json`.

For a supported local JSON slice, open the [case builder](https://blucca.github.io/n8n-check/), save `case.json` and download the separate **inactive editor test**. Your teammate imports it into their existing n8n and clicks **Execute workflow**. Record the result from **Check expected output**, the execution and the n8n version. [Editor scope and instructions](../examples/editor-tests/README.md) cover v1 execution order, single-inlet local nodes and the existing CLI/CI route for HTTP mocks and extended cases.

## Copy this acceptance card

```markdown
## Acceptance — <workflow name>
- Owner / teammate running it: <names>
- Workflow release and exact export: <tag/commit or dated revision; file>
- Instance n8n version: <exact version>
- Fixed input and saved case: <files + revisions; input-node name>
- Checked output: <node name; branch index>
- Expected + business basis: <JSON/count/ordered values; rule/approval>
- Current inactive editor test: <file; source-export revision>
- Actual run: <execution; teammate/date; passed/error; output/log>
- External delivery: <outside this check OR destination receipt/record IDs>
- Next release: <new export; same case; new test; actual version/result>
```

## Try an existing recorded control

Download [ids-fixed.json](https://blucca.github.io/n8n-check/examples/editor-tests/ids-fixed.json), import it as a new workflow and execute it. Three fixed inputs have scores 0.9 (`row-A`), 0.8 (`row-B`) and 0.2 (`distractor`). **Select rows**, output 0, returns two items with `json.id` values `["row-A", "row-B"]`, in that order; `processedAt` may change. **Check expected output** returns `status: "passed"`.

The companion [ids-wrong.json](https://blucca.github.io/n8n-check/examples/editor-tests/ids-wrong.json) keeps two items but changes both IDs to `wrong-row`, triggering an assertion error. These project-run synthetic controls used stock n8n **2.41.7**: fixed exit 0, wrong exit 1. [Recorded results](https://blucca.github.io/n8n-check/examples/editor-tests/observed-results.json) preserve both outcomes. Your teammate’s own run belongs on your card.

## Use the card after the next change

Export the changed workflow and load it in the builder, then choose **Load saved case.json**. Preserve the fixed input and approved expectation; explicitly update node references after a rename. Download a **new inactive editor test**, execute it, and attach its version and result. The earlier editor test remains a snapshot of the earlier code. Record actual external deliveries using their own destination receipts or record IDs.
