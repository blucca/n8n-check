WITH params AS (
  SELECT timestamptz '2026-11-17T00:00:00Z' AS now,
         timestamptz '2026-11-10T00:00:00Z' AS baseline_start,
         timestamptz '2026-11-16T18:00:00Z' AS recent_start,
         6::int AS recent_hours
), workflow_names(workflow_id) AS (
  VALUES ('daily_batch'), ('steady_live'), ('steady_stopped'), ('no_history')
), execution_fixture AS (
  SELECT 'daily_batch'::text AS workflow_id,
         p.baseline_start + i * interval '1 day' + interval '9 hours' AS started_at,
         'success'::text AS status, 'manual'::text AS mode,
         5000::int AS duration_ms, 'synthetic-org'::text AS organization_id
  FROM params p CROSS JOIN generate_series(0, 6) AS i CROSS JOIN generate_series(1, 10) AS event
  UNION ALL
  SELECT w.workflow_id, p.baseline_start + h * interval '1 hour',
         'success', 'manual', 5000, 'synthetic-org'
  FROM params p
  CROSS JOIN (VALUES ('steady_live'), ('steady_stopped')) AS w(workflow_id)
  CROSS JOIN generate_series(0, 167) AS h
  CROSS JOIN generate_series(1, 4) AS event
  WHERE w.workflow_id = 'steady_live' OR h < 162
), buckets AS (
  -- Same GROUP BY and filtering semantics as the original caller; this SELECT
  -- deliberately emits only occupied hours, just like detectWorkflowAnomalies.
  SELECT e.workflow_id,
         to_char(date_trunc('hour', e.started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour,
         count(*)::int AS runs,
         count(*) FILTER (WHERE e.status IN ('error', 'crashed'))::int AS failures,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY e.duration_ms) AS "p95Ms"
  FROM execution_fixture e CROSS JOIN params p
  WHERE e.organization_id = 'synthetic-org'
    AND e.started_at >= p.baseline_start
    AND e.mode IS DISTINCT FROM 'recovery'
  GROUP BY e.workflow_id, hour
), by_workflow AS (
  SELECT w.workflow_id,
         coalesce(jsonb_agg(jsonb_build_object('hour',b.hour,'runs',b.runs,'failures',b.failures,'p95Ms',b."p95Ms") ORDER BY b.hour)
                  FILTER (WHERE b.hour::timestamptz < p.recent_start), '[]'::jsonb) AS baseline,
         coalesce(jsonb_agg(jsonb_build_object('hour',b.hour,'runs',b.runs,'failures',b.failures,'p95Ms',b."p95Ms") ORDER BY b.hour)
                  FILTER (WHERE b.hour::timestamptz >= p.recent_start), '[]'::jsonb) AS recent
  FROM workflow_names w CROSS JOIN params p LEFT JOIN buckets b ON b.workflow_id = w.workflow_id
  GROUP BY w.workflow_id
)
SELECT jsonb_build_object(
  'serverVersion', current_setting('server_version'),
  'now', p.now, 'baselineStart', p.baseline_start, 'recentStart', p.recent_start,
  'recentHours', p.recent_hours,
  'baselineHours', extract(epoch FROM (p.recent_start - p.baseline_start)) / 3600,
  'workflows', (SELECT jsonb_object_agg(workflow_id,jsonb_build_object('baseline',baseline,'recent',recent)) FROM by_workflow)
) FROM params p;
