# Test the transformation between Google Sheets and Slack

**Keep the complete export. Inject two invoice rows. Check both notifications before delivery.**

This synthetic workflow includes `Start → Read invoices (Google Sheets) → Prepare notification (Code) → Notify team (Slack)`. The Sheets and Slack nodes carry synthetic credential references. The case replaces Sheets with fixture items and sets `"stopAfter": "Prepare notification"`, so the real Code node executes and the Slack node stays outside the run.

The original export stays unchanged. The prepared workflow, omitted nodes, and boundary change appear in the run artifacts.

## Recorded result

Real n8n **2.41.7**, n8n-check **0.1.5**, synthetic invoice fixtures, and loopback-only networking:

| Export | n8n execution | Notification items | Contract |
|---|---|---:|---|
| Fixed transformation | Success | 2 | 4/4 checks, exit 0 |
| Deliberate `slice(0, 1)` regression | Success | 1 | Exact output fails, exit 1 |

Both runs omit the Slack delivery node and make zero HTTP requests. [Read the versioned results, file hashes, and expected/actual items](observed-results.json).

## Run both shapes

From an n8n-check checkout with Docker installed:

```sh
docker build -t n8n-check .
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/stop-after/fixed.json examples/stop-after/case.json \
  --out /work/results/stop-after-fixed
# Expected: exit 0; both complete notification items match.

docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/stop-after/broken.json examples/stop-after/case.json \
  --out /work/results/stop-after-broken
# Expected: exit 1; the Code node succeeds but drops the second invoice.
```

For an installed runtime, use `node bin/n8n-check.mjs` with the same two files, plus `--n8n /path/to/n8n --allow-network --out results/stop-after-fixed` for trusted local development.

## Start with your own full export

In the [case builder](https://blucca.github.io/n8n-check/), import the export, choose the input and expected-output nodes, then enable **Run through selected output**. Review the selected execution slice and finish the fixture JSON. This example supplies pins for both selected nodes.

The equivalent draft command is:

```sh
node bin/n8n-check.mjs init examples/stop-after/fixed.json \
  --input "Read invoices" --assert "Prepare notification" \
  --stop-after "Prepare notification" --out invoice.case.json
```

n8n-check **v0.1.5+** supports one optional top-level field:

```json
{ "stopAfter": "Prepare notification" }
```

Add that field to a complete case containing `version`, `name`, `input`, `mocks`, and `assertions`, as shown in [`case.json`](case.json).

## Execution scope

- `stopAfter` cuts every outgoing connection at that node. Independently reachable sibling branches continue to execute and retain their fixture/mock requirements. Review the displayed slice before running.
- The named node must exist and be reachable from the fixture input. Choose a node after a loop's completed output; nodes inside directed cycles produce a setup error.
- Original incoming dependencies, references to omitted nodes, and assertion-node membership still receive structural checks. Keep the slice self-contained.
- With the field omitted, all reachable downstream nodes execute, preserving the existing case behavior.
- This contract covers invoice-to-notification transformation. Sheets reads and Slack delivery are separate integration checks. The connector nodes here contain synthetic placeholders for the bounded-slice example.
- Date-dependent logic uses the runtime's clock. Fixed-time scheduling and calendar tests require their own clock-aware fixture design.
