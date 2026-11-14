#!/usr/bin/env python3
"""Check run.sh exit aggregation without Docker; native results are recorded separately."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    shutil.copyfile(Path(__file__).with_name("run.sh"), root / "run.sh")
    docker = root / "docker"
    docker.write_text("""#!/bin/sh
case "$*" in
  *original.workflow.json*empty.case.json*) exit 1 ;;
  *fixed.workflow.json*success.case.json*) [ "${FORCE_FAIL:-0}" = 1 ] && exit 1 ;;
esac
exit 0
""")
    docker.chmod(0o755)
    env = os.environ | {"PATH": str(root) + os.pathsep + os.environ["PATH"]}
    ok = subprocess.run(["sh", "run.sh"], cwd=root, env=env, capture_output=True, text=True)
    assert ok.returncode == 0 and len(ok.stdout.splitlines()) == 6, ok.stdout + ok.stderr
    failed = subprocess.run(["sh", "run.sh"], cwd=root,
                            env=env | {"FORCE_FAIL": "1"}, capture_output=True, text=True)
    assert failed.returncode == 1, failed.stdout + failed.stderr
print("run.sh exit aggregation: passed")
