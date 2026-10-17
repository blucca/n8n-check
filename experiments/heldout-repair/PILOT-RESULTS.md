# Pilot v1: the repair gate stayed closed

[Frozen protocol](PILOT-PROTOCOL.md) · [Every prompt, answer and case report](pilot-v1-results.json) · [CPU run](https://github.com/blucca/n8n-check/actions/runs/39076944599)

The preregistered pilot completed on 2026-10-18: **18 Gemma 4 E2B generations**, two repeats of each family, with one shared initial patch and one revision per feedback arm. Both arms received the full policy and the same invocation/output budgets.

| Family | Initial: reported input passed | Initial: hidden bundle passed | Original-feedback final passed | Contract-feedback final passed |
|---|---:|---:|---:|---:|
| Invoice batch policy | 0/2 | 0/2 | 0/2 | 0/2 |
| Retry identity | 0/2 | 0/2 | 0/2 | 0/2 |
| Raw response retention sentinel | 2/2 | 2/2 | 1/2 | 1/2 |

The first two rows are two repair families, including one researcher-added invoice policy and one synthetic retry task. The last row starts from an already correct native implementation. The repeats, variants and assertions remain grouped within their family.

## What failed

- **Eight of 18 answers failed the frozen JSON/patch schema.** Examples included invalid backtick escaping, unescaped newlines and missing node fields. One answer reached the 1,536-token cap; all feedback fit its 6,000-character cap.
- **Valid transport still exposed baseline coding failures.** One invoice initial patch returned successfully but put new groups in a Map without emitting their first items. The reported-input oracle already caught the empty outcomes and missing writes. Another patch had malformed JavaScript and `!a === b` comparisons. A retry patch put a header-name/value binding inside a single expression; feedback changed capitalization while leaving invalid syntax.
- **Correct-control revision incurred transport regressions.** Both raw initial patches returned `keep:true`. For seed 17701, the original-feedback revision proposed broken file-reading code plus disallowed fields. The contract-feedback revision returned the original native parameters but omitted required type/version fields. That latter failure is a schema rejection of a semantically unchanged parameter set, not evidence that the native extractor broke. Seed 17702 preserved the correct native implementation in both arms.

## Decision

**Stop expanding this paper candidate.** The four core initial patches never reached the reported-input-pass stratum required by the research question. The paired contrast remained at the baseline failure floor. Removing JSON transport could address some rejected answers; the visible valid-code failures and the already complete retry identity fields provide little support for another short run producing the intended held-out-contract signal.

The controls remained healthy: all seven reference bundles passed, comprising **19 real n8n invocations**. Model feedback used 20 invocations and final evaluation used 33, for **72 actual invocations** out of 103 allocated case slots; invalid patches used no runtime slots. The cloud job took 21m24s, including installation. Recorded generation time totaled 552.876 seconds.

This is a bounded feasibility result for the frozen E2B configuration and scoped-node interfaces. The full transcripts, failures, state observations and prospective inputs remain available for reuse. The earlier authored development controls and access-probe collision remain separate.
