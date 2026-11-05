#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Apply the five-file n8n@2.43.0 patch and emit a process-local preload bundle."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

HERE = Path(__file__).resolve().parent
BASE = 'https://raw.githubusercontent.com/n8n-io/n8n/n8n%402.43.0/'
SOURCES = [
    'packages/cli/src/workflow-execute-additional-data.ts',
    'packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.ts',
    'packages/workflow/src/interfaces.ts',
    'packages/workflow/src/index.ts',
]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True, help='Fresh output directory')
parser.add_argument('--base-dir', type=Path, help='Existing exact-tag four-file source cache')
parser.add_argument('--tsc', default='tsc', help='Existing TypeScript compiler executable (5.6+ or 7)')
args = parser.parse_args()
compiler = shutil.which(args.tsc)
if compiler is None:
    parser.error('Build failed: an existing tsc compiler is required; supply its executable with --tsc')
patch = HERE / 'runtime-return-repair.patch'
if not patch.is_file():
    parser.error('Build requires runtime-return-repair.patch alongside build.py')
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=False)
source, emit = out / 'source', out / 'emit'
source.mkdir()
for name in SOURCES:
    if args.base_dir:
        data = (args.base_dir / name).read_bytes()
    else:
        with urllib.request.urlopen(BASE + name, timeout=30) as response:
            data = response.read()
    target = source / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
for command in [['git', 'apply', '--check', str(patch)], ['git', 'apply', str(patch)]]:
    subprocess.run(command, cwd=source, check=True)
roots = [source / name for name in SOURCES[:2]] + [source / 'packages/workflow/src/input-pairing.ts']
command = [compiler, '--noCheck', '--target', 'ES2022', '--module', 'commonjs',
           '--esModuleInterop', '--rootDir', str(source), '--outDir', str(emit), *map(str, roots)]
compiled = subprocess.run(command, cwd=out, capture_output=True, text=True, timeout=120)
(out / 'emit.log').write_text(compiled.stdout + compiled.stderr)
if compiled.returncode:
    raise SystemExit(f'TypeScript emission failed ({compiled.returncode}); see {out / "emit.log"}')
cli = (emit / 'packages/cli/src/workflow-execute-additional-data.js').read_text()
cli = re.sub(r'require\(([\'"])@/', r'require(\1./', cli)
(out / 'patched-cli.js').write_text(cli)
shutil.copyfile(emit / 'packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.js',
                out / 'patched-ExecuteWorkflow.js')
shutil.copyfile(emit / 'packages/workflow/src/input-pairing.js', out / 'input-pairing.cjs')
shutil.copyfile(HERE / 'return-repair-preload.cjs', out / 'return-repair-preload.cjs')
names = ['patched-cli.js', 'patched-ExecuteWorkflow.js', 'input-pairing.cjs', 'return-repair-preload.cjs']
receipt = {'status': 'complete', 'base': 'n8n@2.43.0',
           'source_origin': str(args.base_dir.resolve()) if args.base_dir else BASE,
           'typescript': subprocess.check_output([compiler, '--version'], text=True).strip(),
           'emit_command': command, 'artifact_files': names,
           'scope': 'Output-scoped source/emission; installed n8n package preserved'}
(out / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
