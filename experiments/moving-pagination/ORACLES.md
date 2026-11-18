# Oracle provenance and cuts

These predictions are written before the first official execution. The inputs are original synthetic immutable IDs from the frozen `PROTOCOL.md`; `run.js` implements a read-only API protocol model using Node's standard library.

## Three independent roles

1. **Source** owns initial membership, the one scheduled transition, the immutable S0 snapshot, every page's live/served state, and final membership. Its journal remains server-side throughout collection. A page's membership transition occurs on the HTTP response `finish` event after the first response; an in-process response uses the equivalent boundary after returning its first projected page.
2. **Collector** receives origin/mode and API responses. It follows explicit `nextOffset`/`nextAfter`, records actual request and response fields, and calculates the displayed weak heuristics from those responses alone. It receives no source state or expected predictions.
3. **Evaluator** retrieves independent source truth after collection and compares it with the frozen page/coverage predictions in `SCENARIOS`. The truth-derived continuous set is `initial ∩ final` under this single-transition, initially-absent-insert/no-resurrection model.

Scenario labels appear only in the controller and saved group metadata. Every offset group uses exactly the same API route, request scope and query format; no scenario identity is in URLs, headers or response bodies. The actual server uses one ephemeral loopback port across all groups. HTTP `Date` is disabled, request headers and complete raw response headers/body are retained, and the two ambiguity assertions compare whole saved exchanges without removing fields. The scientific claim concerns protocol-level equality; TCP timing is outside this transcript.

## Fixed prediction table

`AB` below denotes records A and B; every row's full arrays, total and next-cursor predictions are in `SCENARIOS` before execution.

| Group | Frozen page IDs | Totals | Independent expected cut/result |
| --- | --- | --- | --- |
| offset_static_present | AB / CD | 4,4 | Continuous A B C D covered; final C present |
| offset_shift_present | AB / D | 4,3 | Continuous B C D; C missed but finally present |
| offset_shift_absent | AB / D | 4,3 | Continuous A B D covered; final C absent; complete scan transcript matches preceding group |
| offset_churn_present | AB / DX | 4,4 | Continuous B C D; C missed while unique observed count and stable total both equal4 |
| offset_static_absent | AB / DX | 4,4 | Continuous A B D X covered; final C absent; complete scan transcript matches preceding group |
| snapshot_churn | AB / CD | 4,4 | Exact S0 initial-state traversal; live new X falls outside S0 |
| keyset_churn | AB / CD / X | 4,4,4 | Continuous B C D covered; observed A is absent in final state |
| keyset_low_insert | AB / CD | 4,5 | Continuous A B C D covered; newly inserted AA below cursor B missed at scan end |
| confirm_present | AB / D, then C point lookup | 4,3 | Authoritative200/C: present at declared `lookup-1`, `demo-orders` scope |
| confirm_absent | AB / D, then C point lookup | 4,3 | Explicit404/object_not_found: `absent_at_lookup_cut`, same declared cut/scope |
| confirm_error | AB / DX, then C point lookup | 4,4 | 503: unknown membership; the source's true C membership remains outside the collector |

The two ambiguous pairs retain equal requests, offsets, limits, scope, status, items, total and next cursors while independent final C membership differs. Their existing source plans are separate histories, not edits selected after a run. Confirmation groups also preserve the exact earlier scan exchanges before adding their point lookup.

The stable-count weak heuristic is terminal traversal + equal per-page totals + unique observed count matching that total. The last-count heuristic compares unique observed count with the last reported total. Both operate solely on the transcript; their success in the churn-present example is explicitly compatible with a continuously present missing C. A missing-ID absence candidate is displayed as a weak heuristic, separate from point membership.

## Finite independent count oracle

Six keys A B C D E F and all63 nonempty initial subsets:

- No-op:63.
- One deletion: `6 × 2^5 = 192`.
- One insertion from initially absent keys: `6 × (2^5 − 1) = 186`.
- One deletion plus one initially absent insertion: `6 × 5 × 2^4 = 480`.
- Total unique histories: `63 + 192 + 186 + 480 = 921`, with921 offset and921 immutable-keyset scans.

The generator asserts unique `(initial subset, removed key, inserted key)` histories and these independent counts. Every collector stops before a seventh request. The evaluator records all921 continuous-ID inclusion outcomes, all offset counterexamples, and the complete source journals and traces for counterexamples. The frozen keyset prediction is zero continuous-ID counterexamples; offset is predicted to have at least one. Their exact offset-counterexample count and realized maximum page counts are observations, not preselected oracle values or production-frequency estimates.

## Immutable-order argument

A continuously alive key above the current cursor remains eligible for each subsequent keyset read. Cursor advancement to the last returned key reaches or passes that key only by returning it. A terminal response returns all remaining eligible keys in that source state. Under the fixed scope, immutable unique order and single-transition model, continuous initial keys are therefore covered. A new key inserted below an earlier cursor has a different birth cut; observed deleted rows have a different freshness cut. The snapshot conclusion explicitly names **S0**. Point membership explicitly names its authoritative lookup response cut and scope;503 carries no membership result.

## Execution boundary

Author-side `--self-test` uses P/Q/R and Z for five isolated pure assertions. It performs no HTTP, fixed-group execution or finite enumeration. The recorded experiment follows the frozen protocol and separate scientific review. Script PASS means its frozen model assertions passed; independent scientific review remains a separate recorded action.

The artifact contains source/visibility assumptions, original synthetic state histories, observed API transcripts and oracle provenance. Its scope is API pagination and lookup cuts. Destination actions, production deletion, n8n engine/product changes and a finding about HaoPeng's production system sit outside this experiment.
