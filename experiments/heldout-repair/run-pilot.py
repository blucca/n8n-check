"""A bounded paired repair experiment. Model inference has no tools or file access."""
import copy
import datetime
import hashlib
import importlib.metadata
import json
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def parse_answer(answer):
    value = answer.strip()
    fence = re.fullmatch(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", value)
    if fence:
        value = fence[1].strip()
    result = json.loads(value)
    if not isinstance(result, dict):
        raise ValueError("The patch must be one JSON object")
    return result


def patched(task, patch):
    workflow = copy.deepcopy(task["workflow"])
    if task["id"] == "invoice":
        if set(patch) != {"jsCode"} or not isinstance(patch["jsCode"], str):
            raise ValueError('Invoice schema is {"jsCode": "..."}')
        node = next(n for n in workflow["nodes"] if n["name"] == "Group Batch Reminder Keys")
        node["parameters"]["jsCode"] = patch["jsCode"]
    elif task["id"] == "retry":
        if set(patch) != {"expression"} or not isinstance(patch["expression"], str):
            raise ValueError('Retry schema is {"expression": "..."}')
        node = next(n for n in workflow["nodes"] if n["name"] == "Render")
        node["parameters"]["sendHeaders"] = True
        node["parameters"]["headerParameters"] = {"parameters": [{"name": "Idempotency-Key", "value": patch["expression"]}]}
    elif patch == {"keep": True}:
        pass
    else:
        if (set(patch) != {"type", "typeVersion", "parameters"}
                or patch["type"] not in {"n8n-nodes-base.extractFromFile", "n8n-nodes-base.code"}
                or not isinstance(patch["typeVersion"], (int, float))
                or not isinstance(patch["parameters"], dict)):
            raise ValueError("Raw schema is keep:true, or an allowed node type/version/parameters")
        node = next(n for n in workflow["nodes"] if n["name"] == "Read receipt")
        node.update(copy.deepcopy(patch))
    return workflow


def evaluate(task, patch, cases, folder, parse_error=None):
    try:
        if parse_error:
            raise ValueError(parse_error)
        workflow = patched(task, patch)
    except (ValueError, TypeError) as error:
        result = {"family": task["id"], "passed": False, "allocatedExecutions": len(cases), "runtimeExecutions": 0,
                  "patchError": str(error), "cases": [
                      {"name": case["name"], "passed": False, "enginePassed": False,
                       "checks": [{"name": "valid patch schema", "passed": False, "actual": str(error), "expected": "one allowed patch"}]}
                      for case in cases]}
        save(folder / "report.json", result)
        return result
    request = folder.parent / (folder.name + ".request.json")
    save(request, {"family": task["id"], "workflow": workflow, "cases": cases})
    result = subprocess.run(["node", str(HERE / "pilot-evaluate.mjs"), str(request), str(folder)],
                            text=True, capture_output=True, timeout=900)
    (folder.parent / (folder.name + ".log")).write_text(result.stdout + result.stderr)
    if result.returncode not in (0, 1):
        raise RuntimeError("Evaluation infrastructure failed at " + str(folder) + ": " + result.stderr[-3000:])
    report = json.loads((folder / "report.json").read_text())
    report.update(allocatedExecutions=len(cases), runtimeExecutions=len(cases))
    save(folder / "report.json", report)
    return report


def feedback_text(task, cases, report, limit):
    rows = []
    for case, result in zip(cases, report["cases"], strict=True):
        if task["id"] == "invoice":
            inputs = [{key: v[key] for key in ["invoiceId", "customer", "currency", "totalAmount", "paidAmount", "outstandingAmount", "dueDate", "paymentStatus"]} for v in case["invoices"]]
        elif task["id"] == "retry":
            inputs = case["input"]
        else:
            inputs = {"responseValue": case["value"], "utf8Bom": case["bom"]}
        rows.append({"name": case["name"], "input": inputs, "enginePassed": result["enginePassed"],
                     "passed": result["passed"],
                     "failedChecks": [c for c in result["checks"] if not c["passed"]],
                     "passedChecks": [c["name"] for c in result["checks"] if c["passed"]]})
    text = json.dumps({"allocatedExecutions": len(cases), "runtimeExecutions": report["runtimeExecutions"], "cases": rows}, ensure_ascii=False, separators=(",", ":"))
    return text[:limit], {"untruncatedCharacters": len(text), "characters": min(len(text), limit), "truncated": len(text) > limit}


def self_check():
    assert parse_answer('```json\n{"keep":true}\n```') == {"keep": True}
    try:
        parse_answer('explanation {"keep":true}')
        raise AssertionError("Prose was accepted")
    except json.JSONDecodeError:
        pass
    task = {"id": "retry", "workflow": {"nodes": [{"name": "Render", "parameters": {"jsonBody": "unchanged"}}]}}
    result = patched(task, {"expression": '={{ JSON.stringify([$json.tenant,$json.shortId,$json.revision]) }}'})
    assert result["nodes"][0]["parameters"]["jsonBody"] == "unchanged"
    assert "sendHeaders" not in task["workflow"]["nodes"][0]["parameters"]
    assert result["nodes"][0]["parameters"]["headerParameters"]["parameters"][0]["name"] == "Idempotency-Key"
    print("pilot parsing and patch-placement checks passed")


def main():
    if sys.argv[1:] == ["--self-check"]:
        return self_check()
    if len(sys.argv) != 4:
        raise SystemExit("Usage: run-pilot.py MODEL.litertlm SPEC.json OUTPUT_DIR")
    import litert_lm  # The no-model self-check uses only the standard library.

    model, spec_path, out = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:])
    if out.exists() and any(out.iterdir()):
        raise ValueError("OUTPUT_DIR must be fresh or empty")
    out.mkdir(parents=True, exist_ok=True)
    spec = json.loads(spec_path.read_text())
    budget = spec["budget"]
    metadata = {"protocol": spec["protocol"], "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                "specSha256": hashlib.sha256(spec_path.read_bytes()).hexdigest(), "model": spec["model"],
                "installedRuntime": importlib.metadata.version("litert-lm-api"), "budget": budget}
    save(out / "metadata.json", metadata)
    save(out / "frozen-spec.json", spec)
    reference_results = []
    for task in spec["tasks"]:
        for label, cases in [("contract", task["feedback"]["contract"]), ("hidden", task["hidden"])]:
            result = evaluate(task, task["reference"], cases, out / "references" / (task["id"] + "-" + label))
            reference_results.append({"family": task["id"], "label": label, "passed": result["passed"]})
            if not result["passed"]:
                raise RuntimeError("Frozen reference failed before model generation: " + task["id"] + "-" + label)
        if "alternativeReference" in task:
            result = evaluate(task, task["alternativeReference"], task["hidden"], out / "references" / (task["id"] + "-alternative"))
            reference_results.append({"family": task["id"], "label": "alternative", "passed": result["passed"]})
            if not result["passed"]:
                raise RuntimeError("Alternative reference failed")
    save(out / "reference-gate.json", reference_results)

    generations, pairs = [], []
    started = time.monotonic()
    with litert_lm.Engine(str(model), backend=litert_lm.Backend.CPU(), max_num_tokens=spec["model"]["maxContextTokens"]) as engine:
        metadata["modelLoadSeconds"] = round(time.monotonic() - started, 3)
        save(out / "metadata.json", metadata)

        def generate(task, seed, label, prompt):
            call_started = time.monotonic()
            with engine.create_conversation(
                sampler_config=litert_lm.SamplerConfig(top_k=budget["topK"], top_p=budget["topP"], temperature=budget["temperature"], seed=seed),
                thinking_config=litert_lm.ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
                max_output_tokens=budget["maxOutputTokens"],
            ) as conversation:
                response = conversation.send_message(prompt)
            answer = "".join(x.get("text", "") for x in response.get("content", []) if x.get("type") == "text")
            value = {"family": task["id"], "role": task["role"], "label": label, "seed": seed, "prompt": prompt,
                     "answer": answer, "response": response, "seconds": round(time.monotonic() - call_started, 3),
                     "promptTextTokens": len(engine.tokenize(prompt)), "answerTextTokens": len(engine.tokenize(answer))}
            try:
                value["patch"] = parse_answer(answer)
                patched(task, value["patch"])
            except (ValueError, TypeError) as error:
                value["parseError"] = str(error)
            save(out / "generations" / (label + ".json"), value)
            generations.append(value)
            print(json.dumps({"generation": label, "answerTextTokens": value["answerTextTokens"], "seconds": value["seconds"], "parseError": value.get("parseError")}), flush=True)
            return value

        # No hidden execution results exist in any model conversation.
        for task in spec["tasks"]:
            for index, seed in enumerate(budget["seeds"]):
                label = task["id"] + "-" + str(seed)
                initial = generate(task, seed, label + "-initial", task["prompt"])
                pair = {"family": task["id"], "role": task["role"], "seed": seed, "initial": initial, "arms": {}}
                for arm in (["original", "contract"] if index % 2 == 0 else ["contract", "original"]):
                    cases = task["feedback"][arm]
                    report = evaluate(task, initial.get("patch"), cases, out / "feedback" / (label + "-" + arm), initial.get("parseError"))
                    feedback, counts = feedback_text(task, cases, report, budget["feedbackCharacterLimit"])
                    prompt = (task["prompt"] + "\n\nYour initial answer was:\n" + initial["answer"]
                              + "\n\nExecution feedback on that answer:\n" + feedback
                              + "\n\nReview your patch against the full requirements. You have one final revision. Return only the allowed JSON patch; keep a correct patch unchanged.")
                    final = generate(task, seed + budget["revisionSeedOffset"], label + "-" + arm, prompt)
                    pair["arms"][arm] = {"feedbackPassed": report["passed"], "feedbackFirstCasePassed": report["cases"][0]["passed"], "feedbackCounts": counts, "final": final}
                    save(out / "pairs" / (label + ".json"), pair)
                pairs.append(pair)

    # All answers are now immutable. Evaluate the same hidden bundles on each.
    summaries = []
    for pair in pairs:
        task = next(t for t in spec["tasks"] if t["id"] == pair["family"])
        label = task["id"] + "-" + str(pair["seed"])
        summary = {"family": task["id"], "role": task["role"], "seed": pair["seed"], "outcomes": {}}
        for arm, generation in [("initial", pair["initial"])] + [(a, pair["arms"][a]["final"]) for a in ["original", "contract"]]:
            report = evaluate(task, generation.get("patch"), task["hidden"], out / "hidden" / (label + "-" + arm), generation.get("parseError"))
            summary["outcomes"][arm] = {"passed": report["passed"], "patchError": report.get("patchError"),
                "cases": [{"name": c["name"], "passed": c["passed"], "enginePassed": c["enginePassed"], "failedChecks": [x["name"] for x in c["checks"] if not x["passed"]]} for c in report["cases"]]}
        summary["initialOriginalBundlePassed"] = pair["arms"]["original"]["feedbackPassed"]
        summary["initialReportedInputPassed"] = pair["arms"]["original"]["feedbackFirstCasePassed"]
        summary["initialContractProbePassed"] = pair["arms"]["contract"]["feedbackPassed"]
        summary["originalBundlePassHiddenFail"] = summary["initialOriginalBundlePassed"] and not summary["outcomes"]["initial"]["passed"]
        summary["reportedInputPassHiddenFail"] = summary["initialReportedInputPassed"] and not summary["outcomes"]["initial"]["passed"]
        summaries.append(summary)
        save(out / "summary.json", {"completed": False, "references": reference_results, "pairs": summaries})
    result = {"completed": True, "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "generationCount": len(generations), "sourceFamilies": 2, "retentionFamilies": 1,
              "references": reference_results, "pairs": summaries}
    save(out / "summary.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
