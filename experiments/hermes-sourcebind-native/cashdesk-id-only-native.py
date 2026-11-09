"""Real Hermes dispatcher checks against Cash Desk's fictional customers.

Install/enable both plugins in a dedicated HERMES_HOME, then run with the
Hermes checkout's Python. Only imports, customer replies and source reads run.
"""

import argparse
import json
from pathlib import Path
import shlex
import sqlite3
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.hermes))
    from hermes_cli.plugins import discover_plugins, get_plugin_command_handler
    from model_tools import handle_function_call
    from plugins.plugin_storage import plugin_data_dir

    discover_plugins()
    command = get_plugin_command_handler("sourcebind")
    assert command
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    source = out / "current-customer.json"
    session = "sourcebind-cashdesk-20261109"
    job = "sample-customer-reply"
    result = {
        "sourcebind_version": "0.1.2",
        "cashdesk_pin": "26d5fabe5f50f250e5dc72c0751adbdb3625f732",
        "kind": "real native dispatcher interoperability checks",
        "data": "Cash Desk bundled fictional customer CSV only",
        "model_turns": 0,
        "outbound_sends": 0,
        "bank_or_invoice_imports": 0,
        "steps": [],
    }

    def save():
        (out / "native-cashdesk.json").write_text(json.dumps(result, indent=2) + "\n")

    def select(customer_id, source_job=job):
        source.write_text(json.dumps({"job": source_job, "customer_id": customer_id}) + "\n")

    def call(name, arguments):
        value = json.loads(handle_function_call(
            "tool_call", {"calls": [{"name": name, "arguments": arguments}]},
            session_id=session, task_id=session,
        ))
        result["steps"].append({
            "tool": name, "args": arguments, "result": value,
            "native_transport": "tool_call",
        })
        save()
        return value

    def snapshot():
        database = Path(plugin_data_dir("cash-desk")) / "cashdesk.sqlite"
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
            customers = [
                {"customer_id": row[0], "on_hold": bool(row[1]), "hold_reason": row[2]}
                for row in connection.execute(
                    "SELECT id,on_hold,hold_reason FROM customers WHERE id IN ('C001','C002','C003') ORDER BY id"
                )
            ]
            events = [
                {"kind": row[0], "customer_id": row[1], "detail": json.loads(row[2])}
                for row in connection.execute(
                    "SELECT kind,ref,detail FROM events WHERE kind IN ('hold','reply') ORDER BY id"
                )
            ]
        return {"customers": customers, "events": events}

    def reply(customer_id, marker):
        return call("cashdesk_reply", {
            "customer_id": customer_id,
            "text": f"Fictional customer dispute for the native demo: {marker}.",
            "kind": "dispute",
        })

    imported = call("cashdesk_import", {"kind": "customers", "path": "demo/customers.csv"})
    assert imported.get("ok"), imported
    initial = snapshot()
    assert len(initial["customers"]) == 3 and not any(row["on_hold"] for row in initial["customers"])
    select("C001")
    result["selected_source"] = json.loads(source.read_text())
    baseline = reply("C002", "unbound wrong customer")
    assert baseline.get("ok") and baseline["customer_id"] == "C002" and baseline["held"]
    result["baseline_state"] = snapshot()
    assert result["baseline_state"]["customers"][1]["on_hold"]

    bind = ["bind", job, str(source), "cashdesk_reply"]
    result["default_binding"] = command(shlex.join(bind), session_id=session, platform="cli")
    default = reply("C001", "default mode missing native job argument")
    assert "error" in default
    assert snapshot() == result["baseline_state"]

    result["id_only_binding"] = command(shlex.join(bind + ["id-only"]), session_id=session, platform="cli")
    current = call("sourcebind_current", {})
    assert current["expected_args"] == {"customer_id": "C001"} and current["status"] == "ready"
    before = snapshot()
    wrong = reply("C002", "bound wrong customer")
    assert "error" in wrong and snapshot() == before
    correct = reply("C001", "bound current customer")
    assert correct.get("ok") and correct["customer_id"] == "C001" and correct["held"]
    state = snapshot()
    assert state["customers"][0]["on_hold"] and len(state["events"]) == len(before["events"]) + 1
    result["bound_state"] = state

    select("C003")
    before = snapshot()
    stale = reply("C001", "stale after source rollover")
    assert "error" in stale and snapshot() == before
    fresh = reply("C003", "new current customer after rollover")
    assert fresh.get("ok") and fresh["customer_id"] == "C003" and fresh["held"]
    result["rollover_state"] = snapshot()
    assert result["rollover_state"]["customers"][2]["on_hold"]
    assert len(result["rollover_state"]["events"]) == len(before["events"]) + 1

    before = snapshot()
    source.write_text("{broken JSON\n")
    broken = reply("C003", "broken selected source")
    assert "error" in broken and snapshot() == before
    select("C003", "different-job")
    changed_job = reply("C003", "source job mismatch")
    assert "error" in changed_job and snapshot() == before
    select("C003")
    restored = call("sourcebind_current", {})
    assert restored["status"] == "ready" and restored["expected_args"] == {"customer_id": "C003"}
    result["final_state"] = snapshot()
    result["status"] = "passed"
    save()
    print(json.dumps({
        "status": result["status"], "native_calls": len(result["steps"]),
        "recorded_customer_effects": len(result["final_state"]["events"]),
        "artifact": str(out / "native-cashdesk.json"),
    }), flush=True)


if __name__ == "__main__":
    main()
