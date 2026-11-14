#!/bin/sh
# Run the existing n8n-check image; see README.md for its fixed-version build.
set -u
cd "$(dirname "$0")"
image="${N8N_CHECK_IMAGE:-n8n-check:0.1.9}"
root="$(pwd)"
mkdir -p results
failed=0
for version in original fixed; do
  for case in empty success request-error; do
    out="results/$version-$case"
    mkdir -p "$out"
    expected=0
    if [ "$version" = original ] && [ "$case" = empty ]; then expected=1; fi
    docker run --rm --network none --memory=650m --memory-swap=650m \
      --user "$(id -u):$(id -g)" -v "$root:/work" "$image" \
      "$version.workflow.json" "$case.case.json" --out "/work/$out" --json \
      > "$out/cli.stdout.json" 2> "$out/cli.stderr.txt"
    actual=$?
    printf '%s/%s: exit %s (expected %s)\n' "$version" "$case" "$actual" "$expected"
    if [ "$actual" -ne "$expected" ]; then failed=1; fi
  done
done
exit "$failed"
