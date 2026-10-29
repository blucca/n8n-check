# Green execution, wrong gzip file

A runnable regression fixture for [n8n issue #42252](https://github.com/n8n-io/n8n/issues/42252) by **KingTomaHawk** and the Decompress version gate in [PR #42358](https://github.com/n8n-io/n8n/pull/42358) by **mayanksingh-27** (reviewed head `be9a827`). This fixture adds native filename **and decoded-content** checks to the proposed index-level test.

## Real-engine result

Stock **n8n 2.41.7 / nodes-base 2.41.5**, Node v26.12.0; Compression versions **1.1** and **1**. All four items contain **three valid gzip files**; `target.json.gz` moves between keys `data1, data0, data2, data1`. The dynamic field selects by filename. Each decoded JSON also identifies the item, customer and file.

| Branch | Stock | PR's Decompress-only gate applied locally |
|---|---|---|
| Dynamic field, Compression 1.1 | **success**, wrong files/content in items **2 and 3** | **success**, all four targets match |
| Dynamic field, legacy 1 | original index-0 behavior | original behavior preserved |
| Normalize target to `data`, fixed field | all four targets match | all four targets match |

Original modern filenames: `target.json, other-b.json, other-b.json, target.json`. With the gate: four `target.json`, each containing its own expected `customer-N` and `file: target`. [Verified outputs](verified-results.json). Scope: gzip, fixed `file_` output prefix, four input items; real expression evaluation and real decompression.

## Try it

Import [workflow.json](workflow.json) into a test n8n instance and execute its Manual trigger. The **Dynamic modern** and **Fixed field** branches make the silent selection failure and the existing workaround directly comparable. Input files are embedded, synthetic, and require no credentials or external calls.

For automated stock/patch execution, point to an **already installed n8n 2.41.7 runtime directory** containing `node_modules`. From the repo root:

```sh
python3 experiments/compression-field-selection/run.py \
  /path/to/n8n-runtime /path/to/temp/compression-case
```

The output directory must be new. Python's standard library runs two isolated CLI databases, imports the fixture and executes it with `--id`. Each command has a 90-second timeout; the child heap is bounded. [overlay.cjs](overlay.cjs) applies only PR #42358's four-line Decompress index gate in memory. The installed package stays unchanged. [check.py](check.py) validates actual completed executions, filenames, decoded identities, legacy equality and the fixed-field control.

This is independent reproduction/review evidence for the existing issue and fix; credit for their original diagnosis and patch remains with their authors.
