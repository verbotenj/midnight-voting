# Preview acceptance status — 2026-09-13

This is an evidence ledger, not a claim that every original privacy/product goal
is complete. Network IDs and exact receipts are in [PREVIEW-RUNBOOK.md](PREVIEW-RUNBOOK.md).

| Requirement | Evidence | Status / limitation |
| --- | --- | --- |
| P001/P002 eligible; P003 revoked | `lib/preview-issuance.js`, durable-issuance tests, completed CLI outcomes | Demonstrated with fictional records, not real government verification |
| One issuance per identity/election, including copied apps | Atomic owner-only reservation files; concurrent and replacement-deployment tests; CLI `ALREADY_ISSUED`; same-commitment pre-broadcast recovery tests | Demonstrated; uncertain broadcasts require explicit reconciliation, never a fresh entitlement |
| No passport data in Compact state or transaction arguments | `compact/Voting.compact`, actual enrolled commitments, worker input projection | Implemented; authority deliberately knows fictional document IDs |
| Election-scoped credentials | Compact commitment/nullifier domains bind election, instance and contract where appropriate; compiled cross-scope tests | Logic tested; additional real-network cross-election negative tests remain |
| Real ZK proof generation, DUST and Preview inclusion | Deployed verifier keys match local build; seven rechecked finalized receipts | Demonstrated: deployment, two enrollments, open, two ballots, close |
| Single-use voting and closed-election enforcement | Two recorded nullifiers, YES 1 / NO 1, compiled tests, actual runner's duplicate/post-close circuit rejections | Duplicate/post-close rejected before broadcast; do not label these node rejections |
| Invalid proof rejected cryptographically | Captured Preview RPC rejection of mutated proof matched to broadcast journal; unchanged pre-ballot state | Actual node rejection. Local ledger WASM is **not** a cryptographic verifier |
| Clear simulated NFC, payload shapes and human pacing | Passport animation, zero-HTTP-before-issuance checks, actual request/response inspector, Compact signature view | Implemented; no real NFC chip, document reads or biometric work |
| Real chain evidence in app | `preview:ui-check` against actual local app + Preview, desktop/mobile, seven receipts, zero browser writes | Verified; history advances only on user clicks |
| Human-stepped live transaction controls | Election 002: ten real Playwright-driven browser actions completed, seven independently checked receipts, node-rejected modified proof, zero page errors | Full live browser path verified on Preview; no fixtures, automatic retries or wallet-seed regeneration |
| Error/bug checks | Unit and compiled-circuit tests; isolated Playwright success/failure/consent/unknown-outcome tests | Coverage exists, not a certification or exhaustive security audit |
| No passport-to-vote inference from public observation | Secret commitments and private membership witnesses; no identity fields in chain state | No end-to-end anonymity claim: public choices/tally, wallet metadata, timing and same-host operation remain limitations |

## Completed separate-election verification

The original `ELECTION-DEMO-2026-001` is closed. Its records must not be deleted,
reopened, or bypassed through a replacement deployment. The user approved a
**separate** `ELECTION-DEMO-2026-002` to run the entire UI broadcast path.
That verification completed at `2026-09-13T04:18:12.536Z`: CLOSED, two eligible
credentials, two used nullifiers, YES 1 / NO 1. Exact receipts and the report path
are in [the runbook](PREVIEW-RUNBOOK.md).

The new election has a fixed separate persistent directory, preserving the
existing wallets, old deployment and election-scoped issuance records. A before/
after recursive file-content fingerprint confirmed the entire 001 archive was
unchanged. All ten live steps passed, including authority rejection, local replay
rejection and an actual node rejection; no unresolved journal remained. Both
workers were stopped cleanly after closing. This does not certify exhaustive
interruption handling, real passport verification or end-to-end voter anonymity.
