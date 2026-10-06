# Keep row identities stable as metadata changes

A three-row fixture contains two eligible records and one distractor. The Code node filters by score and adds a fresh `processedAt` timestamp. The contract checks two ordered IDs; timestamps can change between runs.

```json
{ "node": "Select rows", "count": 2, "pluck": "json.id", "equals": ["row-A", "row-B"] }
```

**Available in v0.1.6+.** The [local case builder](https://blucca.github.io/n8n-check/) offers **Selected field + item count**: choose `json.id`, review the expected IDs, and download the case and CI file.

## Run

From a current source checkout, build the isolated runtime:

```sh
docker build -t n8n-check .
docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/identity-projection/workflow.json examples/identity-projection/case.json \
  --out /work/results/identity-fixed
# Exit 0: two items, both expected IDs.

docker run --rm --network none -v "$PWD:/work" n8n-check \
  examples/identity-projection/wrong-id.json examples/identity-projection/case.json \
  --out /work/results/identity-wrong
# Exit 1: two items, wrong IDs; the n8n execution still succeeds.
```

## Recorded comparison

Real n8n 2.41.7, loopback-only network, synthetic data:

| Workflow | Engine | Count | Ordered identities | Contract |
|---|---|---|---|---|
| `workflow.json` | Success | 2: pass | row-A, row-B: pass | 5/5, exit 0 |
| `wrong-id.json` | Success | 2: pass | wrong-row, wrong-row: fail | 4/5, exit 1 |

[Observed checks and source hashes](observed-results.json) record the comparison. The negative control preserves the item count and changes both IDs. This catches a same-size replacement while allowing timestamp metadata to vary.

Projection uses an own-property dotted path from each n8n item. Missing fields produce failure diagnostics. Order and duplicates remain significant. Select full-object `equals` when every output field belongs in the acceptance contract.
