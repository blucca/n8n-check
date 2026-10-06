#!/bin/sh
# Invoke inside a loopback-only network namespace; put n8n 2.41.7 on PATH.
set -eu
PACK=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHECK=$(CDPATH= cd -- "${1:?Usage: run.sh /path/to/n8n-check [results-dir]}" && pwd)
OUT=${2:-"$PACK/results"}
for CASE in two-eligible eligible-paid existing-new duplicate reordered empty-history multiple-existing; do
  node "$CHECK/bin/n8n-check.mjs" "$PACK/fixed.workflow.json" "$PACK/$CASE.case.json" \
    --n8n "$PACK/n8n-datatable.cjs" --out "$OUT/$CASE"
done
if node "$CHECK/bin/n8n-check.mjs" "$PACK/broken.workflow.json" "$PACK/two-eligible.case.json" \
  --n8n "$PACK/n8n-datatable.cjs" --out "$OUT/broken"; then
  echo 'Historical regression unexpectedly passed.' >&2
  exit 1
else
  CODE=$?
  [ "$CODE" -eq 1 ] || exit "$CODE"
fi
node "$PACK/replay.mjs" "$CHECK" "$OUT/replay"
