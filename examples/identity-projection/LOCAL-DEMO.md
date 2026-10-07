# Two rows. Wrong IDs.

Run two n8n workflow exports against the same identity check. Both workflows
complete successfully and return two items. The deliberately changed export
returns the wrong IDs; the check catches it.

## Run the comparison

You need Docker with Linux containers and a shell on Linux, macOS, or WSL2.
Start Docker, extract this ZIP into a new folder, and open a terminal there.

```sh
sh fixed/run.sh
```

Expected: **5/5 checks pass; exit 0**. The two IDs are `row-A`, then `row-B`.

```sh
sh wrong-id/run.sh
```

Expected: **4/5 checks pass; exit 1**. n8n itself succeeds, but the IDs are
`wrong-row`, `wrong-row`. Exit 1 is the intended result for this negative control.
Exit 2 identifies a setup error; read the terminal output before comparing results.

Both folders have the same `case.json`. Each keeps its own JSON/JUnit reports:

- `fixed/results/report.json` and `fixed/results/junit.xml`
- `wrong-id/results/report.json` and `wrong-id/results/junit.xml`

Docker supplies Node and n8n. The first run downloads the official n8n 2.41.7
image and the SHA256-verified n8n-check 0.1.6 runner. The other folder reuses the
Docker image/layers and downloads its own small runner archive. Workflow execution
uses loopback-only networking. All fixture inputs are synthetic. The `README.md`
in each folder explains the runtime, files, and local setup.

## Read the contract

```json
{
  "node": "Select rows",
  "count": 2,
  "pluck": "json.id",
  "equals": ["row-A", "row-B"]
}
```

The fixture supplies three rows. The Code node keeps scores of at least 0.7 and
adds a fresh `processedAt` timestamp. This contract checks the count and ordered
IDs; timestamps remain free to change. Order, duplicates, and missing fields
matter. Use full JSON assertions when every output field is part of the contract.

`recorded-results.json` contains the previously observed checks on n8n 2.41.7.
Your own execution writes fresh results to the two folders above.

## Try your own workflow

Open https://blucca.github.io/n8n-check/ and import your n8n export. Choose a fixture
input and downstream output, then select **Selected field + item count**. Set the
expected IDs and download a local run pack or GitHub Actions file.

Source and runnable case:
https://github.com/blucca/n8n-check/tree/v0.1.7/examples/identity-projection

This demonstration was built by Blucca's autonomous AI engineering practice.
The original runner, fixtures, and packaging are MIT-licensed (LICENSE included).
n8n and Docker retain their respective licenses.
