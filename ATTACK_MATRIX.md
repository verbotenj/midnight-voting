# Attack and failure matrix

The table below describes the **local simulator's HTTP API**, not raw Midnight
transaction responses. For real Preview evidence and each rejection's exact
boundary (authority, local circuit construction or node verification), see
[acceptance status](docs/ACCEPTANCE-STATUS.md) and
[the Preview runbook](docs/PREVIEW-RUNBOOK.md). A modified simulator digest is not
a modified ZK proof; the separate live test mutates a real proof and checks the
node's explicit rejection. Unknown live outcomes must be reconciled, not retried.

| Case | Action | Expected result | Security property |
| --- | --- | --- | --- |
| Same passport requests twice | Send a second commitment for `DEMO-P001` | `409 ALREADY_ISSUED` | The issuer, not the app installation, controls entitlement count. |
| Same credential votes twice | Resubmit a proof from the same local secret | `409 CREDENTIAL_ALREADY_USED` | Election nullifier is deterministic and can be consumed once. |
| Invalid passport | Request with an unknown demo document | `403 NOT_ELIGIBLE` | Only authority registry entries can become eligible. |
| Revoked passport | Request with `DEMO-P003` | `403 REVOKED` | Cryptographically authentic-but-cancelled documents still require an authoritative status check. |
| Modified/fake proof | Change one character of the proof digest | `422 INVALID_PROOF` | Invalid proof material cannot alter the tally or nullifier set. |
| Election A credential in Election B | Recompute or submit against another election ID | `404 ELECTION_NOT_FOUND` in this single-election POC; with a second election it must fail membership | Credential commitments and nullifiers are election-domain-separated. |
| User deletes/reinstalls app | Delete local secret, then request again with the same passport | `409 ALREADY_ISSUED`; user cannot vote without a future recovery design | Reinstallation does not mint another entitlement. Recovery is intentionally out of scope. |
| Two devices request simultaneously | Both submit different commitments for `DEMO-P001` | Exactly one `201 ISSUED`; the other `409 ALREADY_ISSUED` | The authority's atomic election/passport uniqueness record is the boundary. |
| Authority unavailable | Credential request has no network response | UI reports `SERVICE_UNAVAILABLE`; no local credential is saved and no state changes | Failure is retryable and fail-closed. |
| Blockchain transaction submitted twice | Network retries the same proof/transaction | First is accepted; retry hits the already-used nullifier | At-least-once delivery cannot create a second vote. |
| Election closed | Submit an otherwise valid proof after close | `409 ELECTION_CLOSED` | Final tally cannot change after closure. |

The POC's expected results are implemented in `lib/domain.js`, exercised in `tests/domain.test.js`, and exposed through the manual controls and guided demo where useful.
