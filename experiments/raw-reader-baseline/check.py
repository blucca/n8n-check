import json
from pathlib import Path

base = Path(__file__).parent
for name, status, parent_roots in [
    ("raw-a-answer.json", "mismatch", [[0], [1]]),
    ("raw-b-answer.json", "consistent", [[3], [2]]),
]:
    answer = json.loads((base / name).read_text())
    assert answer["status"] == status, name
    assert answer["child_roots"] == [[3], [2]], name
    assert answer["parent_roots"] == parent_roots, name
print("Two saved-call reviewer answers match the native gold status and root sets.")
