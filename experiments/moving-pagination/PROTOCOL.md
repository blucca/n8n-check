# Moving pagination: input-coverage protocol

Status: design frozen before execution. Original synthetic IDs; scope `demo-orders`.

## Question and business cut
A client follows an offset API through its explicit last page. Can its trace establish that it has observed every source record that stayed alive throughout the scan? Can final absence be inferred from a missing ID?

All reads are read-only. No destination writes or production deletion implementation. A point lookup can establish membership at its response cut; actions after that cut have a separate contract. Original HaoPeng is evidence for real nightly-pagination demand, not evidence that his system has this new moving-source failure. Real destructive-sync demand is a research hypothesis.

## Protocol model
- Source: sorted unique immutable string IDs, same fixed source and visibility scope, no hidden filtering. Page size 2.
- Offset response: request offset/limit, HTTP status 200, items = current sorted source slice, total = current cardinality, nextOffset = offset+limit iff that value < total, otherwise null.
- Keyset response: request after/limit, items = current sorted IDs greater than after; nextAfter is final returned key iff further qualifying rows exist, otherwise null. Key and order are immutable. A terminal nextAfter does not assert an end-of-scan snapshot.
- Snapshot offset: all page responses bind the same frozen initial state and explicit snapshot `S0`; live source changes can continue separately.
- At most one scheduled membership transition after the first page; no mutation during a read. Record identities and source visibility are fully stated assumptions.
- Independent truth includes initial source, transition, every source state and final source. Source truth is not passed to the scanner or to the weak coverage/count/absence heuristics.

## Fixed scenarios (11 scan/confirmation groups)
1. `offset_static_present`: initial A B C D, no mutation. C continuously alive and observed.
2. `offset_shift_present`: initial A B C D, remove A after first response. C continuously alive, but offset second page is D; final C alive.
3. `offset_shift_absent`: initial A B C D, remove C after first response. Same client trace as 2 (including total 4→3), final C absent.
4. `offset_churn_present`: initial A B C D, remove A/add X after first response. Pages A B / D X, all totals 4, all IDs unique, C continuously alive but unseen.
5. `offset_static_absent`: initial A B D X, no mutation. Same client trace as 4, final C absent.
6. `snapshot_churn`: initial A B C D, remove A/add X after first response, pinned S0. All initial records observed; X belongs to live final state, not S0. Coverage conclusion names S0.
7. `keyset_churn`: same live change as 4. All continuously alive initial IDs observed. Observed deleted A does not establish final freshness.
8. `keyset_low_insert`: initial A B C D, add AA after first response. Continuous initial IDs observed; new AA below cursor is missed at scan end. No full end-state coverage claim.
9. `confirm_present`: exact pages of 2 plus final authoritative C lookup returns 200/C. Final membership present.
10. `confirm_absent`: exact pages of 3 plus final authoritative C lookup returns explicit 404/object_not_found. Absent only at declared lookup cut and scope.
11. `confirm_error`: exact pages of 4 plus C lookup returns 503. Membership unknown.

## Finite independent check
Universe A B C D E F; nonempty initial subsets; one transition after first response consisting of no-op, one deletion, one insertion, or one deletion plus one insertion of a previously absent key. Unique transitions only. Both offset and immutable-keyset scans must terminate within 6 page reads. Count observed inclusion against independent continuous IDs (initial ∩ final under this single transition/no resurrection model). Record all offset counterexamples; keyset must cover continuous IDs in every enumerated history. This is a bounded model result, plus a separate monotone-order argument; it is not an estimate of production failure frequency.

## Execution and publication boundary
One standard-library Node file, no npm install/framework. Real localhost HTTP scan for the 11 scenarios, separate finite in-process enumeration. Server binds loopback only, ephemeral port, closes after execution. Node memory budget 128MB. Results/progress persist under this directory. Reuse original observations after completion, no additional fixtures or matrices to tune the conclusion.

Success: 2/3 and 4/5 have identical client-visible transcripts; 2/4 miss continuously alive C; the stable-count heuristic is fooled by 4; 6 names its snapshot; 7 covers continuous IDs; 8 exposes low-key insertion; 9/10/11 preserve membership result/cut/scope; the finite keyset check has no continuous-ID counterexample; independent reviewer accepts the stated scope. Publish the complete runnable experiment and positive/negative results once, then stop this research/bridge until real owned source/API semantics or review feedback arrives.

Failure: a frozen predicted result differs, a client relies on hidden source truth, or actual scan/loop/resource execution fails. Preserve the failure and evaluate root cause against this protocol; do not silently edit scenarios/oracle after looking at results.
