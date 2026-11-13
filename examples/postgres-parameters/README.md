# Both queries succeed. One changes the ID.

Postgres **node typeVersion 2.7** can split a comma inside an evaluated scalar Query Parameter. A single array expression preserves each value as one parameter.

These two three-node workflows run the same inputs through a real PostgreSQL `SELECT`. The only processing change is **Query Parameters**:

```javascript
// scalar-workflow.json
={{ $json.client_id }},{{ $json.lead_key }}

// array-workflow.json
={{ [$json.client_id, $json.lead_key] }}
```

The query is identical:

```sql
SELECT $1::text AS client_id, $2::text AS lead_key
```

## Actual native results

| Input `lead_key` | Scalar parameters | Array parameters |
|---|---|---|
| `website:demo_plain` | `website:demo_plain` | `website:demo_plain` |
| `website:demo,a` | **`website:demo`** | `website:demo,a` |

**Both executions finish successfully and return two rows.** The ordinary-ID control passes in both; the comma-bearing value loses its suffix in the scalar run. Exact field checks expose the change.

Recorded November 13, 2026: **n8n 2.41.7 / nodes-base 2.41.5 / Postgres node 2.7 / Node.js 26.12.0 / PostgreSQL 18.6**. The engine, node operation and PostgreSQL driver are stock. The inputs, workflow, database and credential are a synthetic local lab.

- [Complete scalar execution](scalar-execution.json)
- [Complete array execution](array-execution.json)
- [Environment and field-exact comparison](observed-results.json)
- [Small runnable check](verify.mjs)

The saved CLI execution objects retain their executed node records and outputs; the unused local `resumeToken` field is omitted.

## Run it in your own test instance

1. Import [scalar-workflow.json](scalar-workflow.json) and [array-workflow.json](array-workflow.json) into a disposable n8n instance.
2. In **Read Bound Values**, select your sandbox PostgreSQL credential. Keep the exported node at **typeVersion 2.7** to replay this comparison.
3. Execute each workflow and compare the two returned `lead_key` values with **Demo Input**. The SQL is a read-only `SELECT`; it needs no application tables.

The workflow exports reference a fictional lab credential. Select your own test credential after import. These integration examples use n8n directly; the n8n-check fixture runner keeps credentialed nodes behind fixture or HTTP-mock boundaries.

To verify the recorded results locally, with Node.js:

```sh
node examples/postgres-parameters/verify.mjs
```

To check new CLI `--rawOutput` execution JSONs, save them as `scalar-execution.json` and `array-execution.json` alongside copies of the two workflow files, then pass that directory to `verify.mjs`.

## Why it happens, and which version matters

The v2.7 operation evaluates each scalar expression and passes the resulting text through `stringToArray()`, whose separator is a comma. This test turns `website:demo,a` into two values. The query runner reads the first two parameter positions, producing the shortened key. The array form uses the array values directly.

The [official n8n 2.47.5 operation source](https://github.com/n8n-io/n8n/blob/n8n%402.47.5/packages/nodes-base/nodes/Postgres/v2/actions/database/executeQuery.operation.ts#L88-L153) retains that scalar path for exported nodes below **2.8** and adds a single-expression/single-bind path for **2.8+**. The [helper](https://github.com/n8n-io/n8n/blob/n8n%402.47.5/packages/nodes-base/nodes/Postgres/v2/helpers/utils.ts#L46-L51) contains the comma split. Runtime release and exported node typeVersion are separate settings. The native result above is for **2.41.7 / node 2.7**; the 2.47.5 detail is source inspection.

This check followed the remaining comma-parameter item in [the HVAC V3.1 failure-path report](https://github.com/Ashwin-Choudhary/n8n/issues/1). Its author supplied the original report and a separate [21-scenario repair](https://github.com/Ashwin-Choudhary/n8n/pull/2). This pack tests only the two-parameter binding boundary with invented data. The real HVAC workflow, allowed claim statuses, retries and external integrations belong to that author's own acceptance run.
