# Sparse hourly history can invent a workflow outage

**A normal daily batch produced a false `silence` warning.** The same detector correctly identified a genuinely stopped hourly workflow.

This is a self-written consumer regression for [Loopmend commit `7f2cdd3`](https://github.com/shamsad-alam-meraj/loopmend/commit/7f2cdd32bc43f887ded3e30b06b983060c84a64f). PostgreSQL 18.6 aggregates synthetic executions with the caller's filtering and hourly `GROUP BY` expressions; Node 26.12.0 executes the unchanged original detector. The measured scope is that aggregation-to-detector boundary.

## The denominator

The [caller](https://github.com/shamsad-alam-meraj/loopmend/blob/7f2cdd32bc43f887ded3e30b06b983060c84a64f/src/services/reliability.service.ts) retrieves a seven-day lookback and separates the most recent six hours. At the fixture's fixed UTC boundary, the earlier baseline spans **162 hours**. SQL emits a row for each occupied hour.

The [detector](https://github.com/shamsad-alam-meraj/loopmend/blob/7f2cdd32bc43f887ded3e30b06b983060c84a64f/src/lib/analytics/anomaly.ts) estimates recent expected runs using `baseRuns / baseline.length * recentHours`. In a workflow that runs ten times at 09:00 each day, seven occupied rows contain 70 runs. During its scheduled quiet six-hour window:

- Original expectation: `70 / 7 * 6 = 60` runs → silence warning.
- Elapsed-window rate: `70 / 162 * 6 ≈ 2.593` runs → below the detector's six-run silence threshold.

The fixture defines that quiet interval as normal. A normalization control supplies the missing baseline hours with `runs: 0`, `failures: 0`, and `p95Ms: null`, keeping the original detector unchanged.

| Synthetic workflow | Earlier occupied hours | Earlier runs | Recent runs | Original detector | Complete-baseline control |
|---|---:|---:|---:|---|---|
| Daily batch, normal quiet interval | 7 | 70 | 0 | **False silence** | Quiet |
| Steady hourly, still running | 162 | 648 | 24 | Quiet | Quiet |
| Steady hourly, stopped for six hours | 162 | 648 | 0 | Silence | Silence |
| No history | 0 | 0 | 0 | Quiet | Quiet |

[Recorded result](result.json). The normalization control establishes the denominator effect for these fixtures. An application fix can complete the baseline hours or pass an explicit baseline duration; its actual scheduling contract determines further acceptance cases.

## Reproduce

Use PostgreSQL and Node with native TypeScript support (tested versions above). From this directory:

```sh
mkdir -p temp/sparse-hourly-history
curl -fsSL https://raw.githubusercontent.com/shamsad-alam-meraj/loopmend/7f2cdd32bc43f887ded3e30b06b983060c84a64f/src/lib/analytics/anomaly.ts   -o temp/sparse-hourly-history/anomaly.ts
psql "$DATABASE_URL" -XqAt -f fixture.sql > temp/sparse-hourly-history/fixture.json
node check.mjs "$PWD/temp/sparse-hourly-history/anomaly.ts"   "$PWD/temp/sparse-hourly-history/fixture.json"
```

**Expected exit: 1**, with `normal daily batch produced a false silence alert`; the other controls and normalization assertions complete first. The SQL is one `SELECT` over CTE fixtures. The original detector is fetched locally from its immutable source; this directory publishes our fixture, consumer test, and observations.

Built and measured with Codex. Original application/detector credit: Shamsad Alam Meraj / Loopmend.
