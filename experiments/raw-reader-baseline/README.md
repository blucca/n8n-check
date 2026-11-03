# Closed-book review of saved-call identity

A small strong-model baseline for our previously recorded synthetic n8n bug.
The original child returns business values originating at caller items 3 and 2,
while the parent exposes items 0 and 1. The repair preserves items 3 and 2.
All executions succeed and business JSON values match. The distinguishing evidence
is the saved source/paired-item graph.

## Protocol

On 4 November 2026, each case was submitted to a separate fresh Codex CLI session
with the same closed-book instruction, complete raw parent/child records, and JSON
answer schema. File names and expected answers were absent from model input.
Shell, collaboration, app, browser, computer, and code-mode-host tools were disabled.
Actual model tool actions: zero. A startup code-mode-host availability diagnostic
was retained in the private operational log; both valid final answers are published here.

- Client: Codex CLI 0.163.0.
- Model route selector: `gpt-6.1-sol`, reasoning effort `xhigh`.
- Input: existing self-authored synthetic n8n 2.41.7 saved records.
- One valid generation per case; inference errors receive no replacement answer.
- Score: pair status and both root sets against the independently recorded native
  selection/HTTP outcome. The scorer uses explicit gold values below.

## Results

| Complete raw case | Child roots | Parent roots | Model verdict |
|---|---|---|---|
| Original mismatch | [3], [2] | [0], [1] | mismatch |
| Repaired control | [3], [2] | [3], [2] | consistent |

Both final answers identify all requested root sets and the correct status.

This is a two-case check within one known regression family. It is a baseline
observation for these records and instructions. The existing deterministic audit
remains the reproducible release check; model review helps explain the recorded graph.
Further protocol research needs a new, predeclared case family or a measured gap
against this complete-information baseline.

## Inspect and reproduce

Inputs are maintained once in [`../lineage-boundary/recorded`](../lineage-boundary/recorded).
The source bug, repair and original native HTTP observations are documented in
[`../lineage-boundary`](../lineage-boundary).

From the repository root, reconstruct either exact prompt:

```sh
python3 experiments/raw-reader-baseline/make-prompt.py \
  experiments/lineage-boundary/recorded/original-parent.json \
  experiments/lineage-boundary/recorded/original-child.json
```

Use the repaired file pair for the control. Supply the printed input to a fresh
`codex exec --ephemeral --json` session with the model route above (or report your
own route), the published answer schema, and the same disabled tools. Credentials
and provider configuration stay with the runner. Preserve the first final answer
and operation failures separately. The full raw records, instruction and structured
answers are the reusable research artifacts; private account data, costs and model
reasoning logs are excluded from this public package.

Run the artifact check with `python3 experiments/raw-reader-baseline/check.py`.

## Relation to evidence-based review

[GAVEL](https://aclanthology.org/2026.findings-acl.1789.pdf) combines evidence contracts,
identifier/quote checks and LLM scrutiny for fact-checking. Our task concerns
transitive execution-item identity using actual saved connections and pairing,
with complete raw evidence supplied equally to the reviewer and deterministic audit.
These preliminary controls establish the baseline before investing in a larger
agent-handoff comparison. The existing trace, auditor and this preflight were
created before the Swarm Alignment research weekend.
