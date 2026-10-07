// Portable browser module: UTF-8, uncompressed ZIP; no network or dependencies.
export const RUNNER_URL = 'https://github.com/blucca/n8n-check/releases/download/v0.1.6/blucca-n8n-check-0.1.6.tgz';
export const RUNNER_SHA256 = '8ac4b07df6fc6eb83726793137e5ad3eb7e97f5bcca243a97cc6c82e6a5ed53d';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function localBundleFiles({ workflow, caseFile, n8nVersion = '2.41.7' }) {
  if (typeof n8nVersion !== 'string' || !versionPattern.test(n8nVersion)) throw new Error('Choose an exact n8n release, such as 2.41.7.');
  for (const [name, value] of Object.entries({ workflow, caseFile })) {
    if (!value || typeof value !== 'object') throw new Error(`${name}: supply a JSON object.`);
  }
  return {
    'workflow.json': JSON.stringify(workflow, null, 2) + '\n',
    'case.json': JSON.stringify(caseFile, null, 2) + '\n',
    'run.sh': `#!/bin/sh
set -eu
# Setup errors return 2; the final runner preserves its 0/1/2 result.
trap 'code=$?; if [ "$code" -ne 0 ]; then exit 2; fi' 0
cd -- "$(dirname -- "$0")"
ROOT=$(pwd -P)
case "$ROOT" in
  *','* | *':'* | *'\n'*) echo 'Extract into a directory whose path uses letters, spaces, numbers, dashes or underscores.' >&2; exit 2 ;;
esac
mkdir -p .cache results
rm -f results/report.json results/junit.xml
N8N_VERSION=\${N8N_VERSION:-${n8nVersion}}
case "$N8N_VERSION" in *'\n'*) echo 'N8N_VERSION: use a single exact release.' >&2; exit 2 ;; esac
printf '%s\\n' "$N8N_VERSION" | grep -Eq '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' || {
  echo 'N8N_VERSION: choose an exact release, such as 2.41.7.' >&2; exit 2;
}
command -v docker >/dev/null 2>&1 || { echo 'Install and start Docker, then run sh run.sh again.' >&2; exit 2; }
[ -f workflow.json ] && [ -f case.json ] || { echo 'Keep workflow.json and case.json beside run.sh.' >&2; exit 2; }
BASE="ghcr.io/n8n-io/n8n:$N8N_VERSION"
IMAGE="n8n-check-local:0.1.6-$N8N_VERSION"
# Docker obtains the official image on first use. This bootstrap sees only .cache.
# Its Node runtime downloads and verifies the fixed runner release on Mac/Linux.
docker run --rm -i --user "$(id -u):$(id -g)" \\
  --mount "type=bind,source=$ROOT/.cache,target=/cache" \\
  --entrypoint node "$BASE" --input-type=module - <<'NODE'
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const file = '/cache/runner.tgz';
const expected = '${RUNNER_SHA256}';
const valid = data => createHash('sha256').update(data).digest('hex') === expected;
let cached;
try { cached = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!cached || !valid(cached)) {
  console.log('Downloading n8n-check v0.1.6...');
  const response = await fetch('${RUNNER_URL}', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Runner download HTTP ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  if (!valid(data)) throw new Error('Runner SHA256 mismatch; download stopped.');
  await writeFile(file + '.partial', data);
  await rename(file + '.partial', file);
}
console.log('Runner SHA256 verified.');
NODE
cat > .cache/Dockerfile <<'DOCKERFILE'
ARG N8N_VERSION
FROM ghcr.io/n8n-io/n8n:\${N8N_VERSION}
USER root
ADD runner.tgz /opt/n8n-check/
USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/n8n-check/package/bin/n8n-check.mjs"]
DOCKERFILE
# Only the verified archive and generated Dockerfile enter the build context.
printf '*\\n!runner.tgz\\n!Dockerfile\\n' > .cache/.dockerignore
docker build --network none --build-arg "N8N_VERSION=$N8N_VERSION" --tag "$IMAGE" .cache
printf '\\nRunning checks with n8n %s; results: %s/results\\n' "$N8N_VERSION" "$ROOT"
trap - 0
set +e
docker run --rm --network none --user "$(id -u):$(id -g)" \\
  --mount "type=bind,source=$ROOT/workflow.json,target=/inputs/workflow.json,readonly" \\
  --mount "type=bind,source=$ROOT/case.json,target=/inputs/case.json,readonly" \\
  --mount "type=bind,source=$ROOT/results,target=/results" \\
  "$IMAGE" /inputs/workflow.json /inputs/case.json --out /results
CODE=$?
case "$CODE" in 0|1|2) exit "$CODE" ;; *) exit 2 ;; esac
`,
    'README.md': `# Run your n8n regression check locally

1. Install and start Docker (Docker Desktop on macOS; Docker Engine/Desktop on Linux).
2. Extract all four files into a dedicated directory.
3. Open a terminal in that directory and run:

\`\`\`sh
sh run.sh
\`\`\`

Selected n8n release: **${n8nVersion}**. To test another exact release:

\`\`\`sh
N8N_VERSION=2.41.7 sh run.sh
\`\`\`

The first run downloads the official n8n image and n8n-check v0.1.6. Docker supplies Node. The runner archive stays in .cache and its SHA256 is checked on every run. Subsequent runs reuse Docker layers and the verified archive. An uncached n8n version needs internet access. Choose a published version supported by your workflow's nodes and the runner (Node 24+).

The workflow executes with Docker --network none: HTTP mocks use loopback, and external networking is disabled. workflow.json and case.json are mounted read-only; results/ is writable. Execution uses your local UID/GID and a fresh n8n database. Use trusted workflows and synthetic fixtures; workflow code executes in the container. Inline values and assertion differences can appear in local reports.

Results: results/report.json and results/junit.xml. Exit codes: 0 passed, 1 regression, 2 setup error. Each attempt clears the previous two report files; setup errors appear in the terminal. Save reports before rerunning when comparing versions.

Keep Docker running and allow it access to this directory. Windows users can run the bundle inside WSL with Docker integration. Directory paths may contain spaces; choose paths free of commas, colons and line breaks for Docker bind mounts.

Edit case.json to add fixtures, HTTP contracts or assertions, then rerun the same command. The bundle contains the original workflow export and the case selected in the builder; review their contents before sharing.

Runner: ${RUNNER_URL}
SHA256: ${RUNNER_SHA256}
Documentation: https://github.com/blucca/n8n-check
`,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildLocalBundle(options) {
  const encoder = new TextEncoder();
  const files = Object.entries(localBundleFiles(options)).map(([name, text]) => ({ name: encoder.encode(name), data: encoder.encode(text) }));
  const size = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length + 46 + file.name.length, 22);
  if (size > 0xffffffff) throw new Error('Bundle exceeds the ZIP size limit.');
  const zip = new Uint8Array(size);
  const view = new DataView(zip.buffer);
  let offset = 0;
  const u16 = (at, value) => view.setUint16(at, value, true);
  const u32 = (at, value) => view.setUint32(at, value, true);
  for (const file of files) {
    file.offset = offset;
    file.crc = crc32(file.data);
    u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x800);
    u16(offset + 12, 0x21); // Fixed 1980-01-01, deterministic exports.
    u32(offset + 14, file.crc); u32(offset + 18, file.data.length); u32(offset + 22, file.data.length);
    u16(offset + 26, file.name.length);
    zip.set(file.name, offset + 30); zip.set(file.data, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.data.length;
  }
  const centralOffset = offset;
  for (const file of files) {
    u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20); u16(offset + 8, 0x800);
    u16(offset + 14, 0x21); u32(offset + 16, file.crc);
    u32(offset + 20, file.data.length); u32(offset + 24, file.data.length);
    u16(offset + 28, file.name.length); u32(offset + 42, file.offset);
    zip.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  }
  u32(offset, 0x06054b50); u16(offset + 8, files.length); u16(offset + 10, files.length);
  u32(offset + 12, offset - centralOffset); u32(offset + 16, centralOffset);
  return zip;
}
