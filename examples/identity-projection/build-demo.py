#!/usr/bin/env python3
"""Build the downloadable two-export demo using the existing local-pack generator.

Usage: python examples/identity-projection/build-demo.py OUTPUT.zip
Requires Python 3 and Node.js; no third-party packages. The result is deterministic.
"""
import json
from pathlib import Path
import subprocess
import sys
import zipfile

EXAMPLE = Path(__file__).resolve().parent
ROOT = EXAMPLE.parents[1]


def build(output):
    source = """
import { readFileSync } from 'node:fs';
import { localBundleFiles } from './src/local-bundle.mjs';
const read = name => JSON.parse(readFileSync('examples/identity-projection/' + name, 'utf8'));
const packs = {};
for (const [variant, file] of [['fixed', 'workflow.json'], ['wrong-id', 'wrong-id.json']]) {
  packs[variant] = localBundleFiles({ workflow: read(file), caseFile: read('case.json'), n8nVersion: '2.41.7' });
}
process.stdout.write(JSON.stringify(packs));
"""
    packs = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', source], cwd=ROOT, text=True))
    files = {
        'README.md': (EXAMPLE / 'LOCAL-DEMO.md').read_text(),
        'LICENSE': (ROOT / 'LICENSE').read_text(),
        'recorded-results.json': (EXAMPLE / 'observed-results.json').read_text(),
    }
    for variant, pack in packs.items():
        for name, text in pack.items():
            files[f'{variant}/{name}'] = text
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, text in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, text.encode('utf-8'))
    print(f'{output}: {len(files)} files, {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python build-demo.py OUTPUT.zip')
    build(sys.argv[1])
