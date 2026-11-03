# Reconstruct the two closed-book inputs from existing synthetic records.
# Pass original-parent.json original-child.json, or their repaired equivalents.
import json
from pathlib import Path
import sys

parent, child = map(Path, sys.argv[1:])
base = Path(__file__).parent
print((base / "instruction.txt").read_text(), end="")
print("Execution record A:")
print(json.dumps(json.loads(parent.read_text()), ensure_ascii=False, separators=(",", ":")))
print("\nExecution record B:")
print(json.dumps(json.loads(child.read_text()), ensure_ascii=False, separators=(",", ":")))
