#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-all}
IMAGE=ghcr.io/n8n-io/n8n:2.41.7
case "$MODE" in all|deal-failure|negative) ;; *) echo 'Use: sh run.sh [all|deal-failure|negative]' >&2; exit 2 ;; esac
mkdir -p "$HERE/.source" "$HERE/results/$MODE/home"
# Fetch only the public reference files. The workflow runs in the next container.
if [ ! -f "$HERE/.source/source.json" ]; then
  docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    -v "$HERE:/pack:ro" -v "$HERE/.source:/source:rw" \
    "$IMAGE" /pack/fetch-reference.cjs /source
fi
CASE=all
WORKFLOW=/source/invoice-deal-sync.workflow.json
EXTRA=
if [ "$MODE" = negative ]; then CASE=0; WORKFLOW=/source/wrong-amount.workflow.json; fi
if [ "$MODE" = deal-failure ]; then EXTRA=/pack/deal-write-failure.case.json; fi
docker run --rm --network none --user "$(id -u):$(id -g)" --entrypoint node \
  -v "$HERE:/pack:ro" -v "$HERE/.source:/source:ro" -v "$HERE/results/$MODE:/results:rw" \
  -e NATIVE_RUNTIME=/usr/local/lib/node_modules/n8n \
  -e NATIVE_SPEC=/source/invoice-deal-sync.n8n-test.yaml \
  -e NATIVE_WORKFLOW="$WORKFLOW" -e NATIVE_CASE="$CASE" -e NATIVE_EXTRA_CASE="$EXTRA" \
  -e NATIVE_OUT=/results -e HOME=/results/home -e N8N_USER_FOLDER=/results/home \
  -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_TEMPLATES_ENABLED=false -e N8N_COMMUNITY_PACKAGES_ENABLED=false \
  -e N8N_PERSONALIZATION_ENABLED=false -e N8N_RUNNERS_ENABLED=true \
  -e N8N_RUNNERS_MODE=internal -e N8N_RUNNERS_MAX_CONCURRENCY=1 \
  -e N8N_RUNNERS_TASK_TIMEOUT=60 -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true \
  -e N8N_LOG_LEVEL=warn -e N8N_BLOCK_ENV_ACCESS_IN_NODE=true \
  -e N8N_ENCRYPTION_KEY=native-reference-synthetic-disposable \
  "$IMAGE" /pack/run.cjs execute --id=native-reference
