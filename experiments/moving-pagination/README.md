# A complete page scan can miss a live order

Every request succeeds. The client reaches the last page. The received IDs are unique and their count matches every reported total. A continuously live order is still missing.

This runnable, read-only study isolates that failure in a moving source. It uses a small localhost HTTP API and an independent finite state check. The output is an input-coverage contract: which source state or members a page scan actually covers.

## The four-row counterexample

The API sorts immutable IDs and implements `offset` / `limit` against the source state at each request. Page size is two.

| | History P: C stays live | History A: C is absent |
|---|---|---|
| Initial source | A B C D | A B D X |
| First page | A B; total 4; nextOffset 2 | A B; total 4; nextOffset 2 |
| Change before page two | Remove A, insert X → B C D X | No change |
| Second page | D X; total 4; nextOffset null | D X; total 4; nextOffset null |
| Received IDs | A B D X | A B D X |
| Final source membership of C | Present throughout the scan | Absent |

All four received IDs are unique. The count is four in both histories. The protocol-level page traces have the same request fields, status, items, totals and continuation fields. The scanner observes the same evidence in both worlds.

Deleting A moved C to an index below the next offset. X kept the reported cardinality unchanged. A stale observed A occupies the place of unseen live C in the collected set.

A simpler pair also starts with A B C D in both worlds. Removing already-read A or unseen C produces the same A B / D pages and totals 4 → 3. The three collected IDs match the final total in both histories; C's final membership differs.

## Choose the coverage cut

| Source contract | Supported result | Boundary exercised here |
|---|---|---|
| Ordinary moving offset pages | A sequence of successful page observations | A continuously live record can be skipped, even with consistent totals and unique IDs |
| Pages bound to one immutable snapshot S0 | Complete coverage of S0 | New live-state X belongs to a later state |
| Immutable ascending keyset | Coverage of records alive throughout the scan | New AA inserted below the cursor can be missing at the end |
| Authoritative per-ID read in the same scope | Present or absent at that read's cut | A 503 yields unknown; later actions require their own time contract |

Snapshot and keyset contracts describe the source's actual behavior. An opaque cursor's name leaves these semantics to the provider contract.

### Why immutable keyset covers continuous members

Let c be a record present at every read cut, with an immutable key. The cursor advances monotonically through sorted keys. If it passes c's key, the read that crossed it must include c: c was present, greater than the previous cursor, and precedes every larger returned key. If the scan ends before passing c, the final complete page includes c. Thus a continuously present c is observed. A new record inserted behind the cursor has a different premise, as the AA control demonstrates.

The finite check uses one transition after the first response, so its continuous-member oracle is `initial ∩ final`; insertions use previously absent IDs and resurrection is outside that model. The monotone-key argument states the broader read-cut premise explicitly.

## Run

Node.js 24+, with the recorded version shown below. No package install or account setup:

```sh
node --max-old-space-size=128 run.js
```

The script creates a fresh `results/` directory beside itself, binds an ephemeral loopback port, executes the frozen HTTP scenarios, saves the observations and closes the server. For another run, use `mkdir rerun && node --max-old-space-size=128 run.js --out rerun`. It also enumerates all 63 nonempty initial subsets of A–F and unique no-op / deletion / insertion / deletion-plus-insertion transitions after the first response. That is 921 histories per strategy. The HTTP cases and finite in-process model are recorded separately.

[Protocol](PROTOCOL.md) defines the API and the predicted results before execution. Source initial state, transitions and membership truth are recorded independently from scanner-visible responses. Scenario labels stay outside URLs and API responses.

## Observed results

| Evidence | Recorded result |
|---|---|
| Localhost HTTP | 11 frozen groups; 23 page reads, all HTTP 200; 3 point reads with 200 / 404 / 503 |
| Offset ambiguity | Two pairs of complete saved request/response exchanges match field for field; final C membership differs |
| Stable-count pair | Four unique observed IDs, each page total 4, yet continuously live C is missed |
| Snapshot | S0's initial A B C D is covered; live new X is outside S0 |
| Keyset boundary | Continuous initial IDs covered; new AA below cursor missed at the end |
| Point reads | present / absent at lookup cut / unknown, with scope and lookup cut retained |
| Finite model | 921 histories per strategy; offset has 144 continuous-ID counterexamples; immutable keyset has 0 |
| Finite termination | Both strategies used at most 3 pages, within the frozen 6-page bound |

The recorded run used Node v26.12.0 with a 128 MB heap budget; the server closed successfully. These finite counts describe the deliberately enumerated model histories. Production failure frequency depends on the source's actual mutations and scan timing.

The complete [HTTP observations](observed/results.json), [finite summary](observed/finite-summary.json), [all 921 history outcomes](observed/finite-histories.jsonl) and [all 144 offset counterexamples](observed/offset-counterexamples.json) are included. [Oracle provenance](ORACLES.md) separates source truth from the scanner and states the coverage cuts.


## Applying this to an owned integration

Start with the source's paging semantics, the intended coverage cut, the relevant visibility scope and the stable business IDs. A release case can then require a particular membership set or a declared snapshot, and verify the current workflow against it. A record absent from a moving page trace is a candidate for further evidence; authoritative membership reads supply their own cut.

This experiment is an original synthetic API model. Its HTTP traffic targets localhost, and its finite result is scoped to the stated universe and transitions. Real provider measurements, an n8n runtime run, an owner's deployment result and production failure frequency are separate observations. The study creates no destination writes.

The motivating real task category is paginated order synchronization; an [author's account of a green nightly job that fetched only the first page](https://dev.to/haopengai/your-n8n-workflow-only-processed-the-first-page-pagination-bugs-that-look-like-success-21kl) illustrates demand for complete input. That account describes a different failure. Moving-source churn and deletion-by-absence are this study's explicitly declared conditions.
