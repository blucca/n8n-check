# Frozen native acceptance queue

Use a Linux host with Docker and the official cached n8n 2.43.0 image in the runner. Run from the repository root. Each command uses a fresh output directory. The host must have 1536 MiB available for the lab plus room for its existing services. The harness snapshots any existing `zetaris` services and verifies that they keep the same IDs and status. The measured host had four such services.

```sh
export LAB="$PWD/temp/return-native-new"
export CASES="$PWD/experiments/runtime-return-repair/native"
python3 experiments/runtime-return-repair/build.py --output "$LAB/patch"
python3 "$CASES/run-nested.py" --output "$LAB/nested-after" --expect repaired --patch-dir "$LAB/patch"
python3 "$CASES/run-return-controls.py" --output "$LAB/once-before" --caller-mode once --expect original
python3 "$CASES/run-return-controls.py" --output "$LAB/once-after" --caller-mode once --expect repaired --patch-dir "$LAB/patch"
python3 "$CASES/run-nested.py" --output "$LAB/nosave-before" --child-save none --expect original
python3 "$CASES/run-nested.py" --output "$LAB/nosave-after" --child-save none --expect repaired --patch-dir "$LAB/patch"
python3 "$CASES/run-return-controls.py" --output "$LAB/each-after" --caller-mode each --expect repaired --patch-dir "$LAB/patch"
```

Run these commands serially. The runners use a separate SQLite database, loopback HTTP receiver, 2 CPU, 1536 MiB memory, a 640 MiB Node heap and a 360-second wall cap. `result.json` and execution exports provide the checkpoints. This is a controlled lab, with fictional customer/order IDs. Original-source scaffolding is from the existing round401 nested and return-controls experiments; this revision adds the compiled preload, once mode and child-save-none acceptance. The caller-mode change uses the same child graph and input orders.
