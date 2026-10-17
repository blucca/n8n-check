"""One real Gemma coding request; access check, separate from repair evaluation."""
import importlib.metadata
import json
import pathlib
import sys
import time

import litert_lm

model, output = map(pathlib.Path, sys.argv[1:3])
prompt = (
    "Write only one JavaScript expression for an n8n HTTP Request Idempotency-Key. "
    "Each input has $json.tenant, $json.assetId, and $json.revision. "
    "Repeated delivery of the same operation must reuse a key. "
    "Different tenants, assets, or revisions must have distinct keys. "
    "Preserve exact string field values, including punctuation. No prose."
)
started = time.monotonic()
with litert_lm.Engine(str(model), backend=litert_lm.Backend.CPU()) as engine:
    loaded = time.monotonic()
    with engine.create_conversation(
        thinking_config=litert_lm.ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
        max_output_tokens=256,
    ) as conversation:
        response = conversation.send_message(prompt)
finished = time.monotonic()
answer = "".join(item.get("text", "") for item in response.get("content", []) if item.get("type") == "text")
result = {
    "purpose": "actual small-model access check; excluded from repair benchmark results",
    "model": "litert-community/gemma-4-E2B-it-litert-lm",
    "revision": "b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1",
    "runtime": "litert-lm-api " + importlib.metadata.version("litert-lm-api"),
    "backend": "CPU",
    "prompt": prompt,
    "answer": answer,
    "loadSeconds": round(loaded - started, 3),
    "generationSeconds": round(finished - loaded, 3),
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False))
assert answer.strip(), "Gemma returned no text; inspect the model access artifact."
