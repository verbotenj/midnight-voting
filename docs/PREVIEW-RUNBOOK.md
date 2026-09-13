# Midnight Preview: engineering runbook

## Verified browser ballot — election 002

On 2026-09-13 the authorized second election completed through real Playwright
browser clicks against the live local API, without fixtures or direct actor calls
from the test driver. Existing funded Preview wallets and generated DUST were
used; wallet seeds and all election 001 records were preserved.

```text
Election: ELECTION-DEMO-2026-002
Contract: 312f29e6be11c64c44705e35557d687d1a8e642708b2b5413f2d0fb17e8ab6e1
Final state: CLOSED, eligible 2, used nullifiers 2, YES 1 / NO 1
Recovery journals requiring reconciliation: none
```

| Contract call | Finalized block | Transaction ID |
| --- | --- | --- |
| Deployment | 842445 | `007a381f2fbf5f1874542876eb341b0835a0d139fe17337cb8700dc5e2b5891cc5` |
| Enrollment 1 | 842523 | `00bae73c6ac70a7defa0cb0398c638a4ed1f046394366a63b893833cda2a7c52ab` |
| Enrollment 2 | 842531 | `00adcaadb31354eb1b12cf3df3a5c4955eda929f692ac73f64b6144ea6a873c524` |
| Open voting | 842539 | `00af82433c12846ff1c31e52b229ec316276a47028f93d7d59a244c10d7a7bb3ac` |
| Vote 1 | 842548 | `00664028745b55edab63fdcc9a3fb83569f17d3feeb9e72bd797b129a9777aaddd` |
| Vote 2 | 842557 | `00656859940259ff9ab2efd0a4be4bfe56ed09d184a202e37a507e968d02d1ca68` |
| Close election | 842563 | `0041c9e336d06fc215d7387ea88bd495d17a04255166810294855472463cbf79c0` |

All seven receipts are `SucceedEntirely` and independently checked against actual
contract actions, transaction hashes and blocks. The ten browser actions also
verified copied-app denial (`ALREADY_ISSUED`), revoked-document denial (`REVOKED`),
modified-proof node rejection, and duplicate-vote rejection. The first two are
authority decisions without broadcast; duplicate voting fails local circuit
construction without broadcast. The modified proof really reached Preview and
received `1010: Invalid Transaction: Custom error: 115`; unchanged state was
verified before continuing. Its transaction hash is
`d025daab93319c24831af9931a6ec88fd9b7c6bd4529a876fa381a4bfa9a6272`.

The run completed at `2026-09-13T04:18:12.536Z`, with ten actions completed once,
zero browser page errors and both wallet workers shut down cleanly. The public
test report and checkpoint screenshots are in
`.local/ui-checks/live-002-a579406a-aae3-44b6-a19f-8337eb72f4d9/`.
Do not upload the election storage directories: they also contain secrets.

Startup wallet history sync took about seven minutes; subsequent actions reused
the workers. The UI waits for actual finality and requires fresh consent for each
step. It does not turn these timings into a simulated completion percentage.
The NFC animation remains separate, fictional and locally simulated.

## Preserved CLI ballot — election 001

The contract is deployed on Preview:

```text
Election: ELECTION-DEMO-2026-001
Contract: ff78718409d802fd914c9a77dab9e728257df58d9b18f0391e7f2a22af9dcc45
Deployment ID: 00fd096f9a64d7129f2ba2ed4ae9187465f600a1226a3762225a1575804699bf5a
Transaction hash: 554e7e52fc50bd391c44f0dbc291d68f085f0149fa3d374b8019759e01dece49
Finalized block: 829262
Result: SucceedEntirely
```

Deployment used the existing authority wallet and its generated DUST. The initial
state was ENROLLMENT, zero eligible credentials, zero nullifiers and a 0–0 tally.
On 2026-09-12 the separate two-process runner enrolled both credentials, opened
voting, finalized YES and NO and closed the election. Verified final state:
**CLOSED, eligible 2, used nullifiers 2, YES 1 / NO 1**.
The browser has a separate live Preview panel that rechecks these receipts against
the network. Its original NFC/voting animation remains a simulator and does not
submit these transactions. Real live-step controls call the same local workers as
the CLI; the separate election 002 run above verifies the new full browser path.

| Contract call | Finalized block | Transaction ID |
| --- | --- | --- |
| Enrollment 1 | 829464 | `00409ec51536129e7d27e5fd1115f6e033fe2696c0122d535acfb588f32662302a` |
| Enrollment 2 | 829468 | `00182287b7916cccad7b5c4fdbc1c4d9c9d067658ab9e5ea53366a5e0ea6724859` |
| Open voting | 829471 | `006a8097d8d2e97d328776a84cc66f3d45a52de9a111470064eb2aa6cf20f9f1d9` |
| Vote 1 | 829569 | `00b418ddbd1a46ab5b3fac02deb3122816099a80c15930ed8398993690b61028d3` |
| Vote 2 | 829573 | `0022efc675b7fe4707ac2f844bb13b773e0ef105d50ca408b069c378df4b930a6e` |
| Close election | 829577 | `008dc0482714fa76014243a1ac1c1fa40032606284622112a0b722f20fc44bdded` |

All six receipts were `SucceedEntirely`, with state assertions after each call.
Owner-only records and the completed `ballot-report-*.json` remain under
`.local/preview-voting/`. Do not upload that directory; it also contains secrets.

The authority refused the copied-app request, P003 and an unknown document without
chain transactions. A duplicate ballot and a post-close ballot failed local
compiled-circuit construction (`CREDENTIAL_ALREADY_USED`, `VOTING_NOT_OPEN`),
without broadcast. These are distinct from the modified-proof transaction actually
submitted to Preview and rejected by the node with `1010: Invalid Transaction:
Custom error: 115`. Its transaction hash was
`1bb81bba8eb51ada9d8b456a796584b2abc31ab530edc171859098f133c2b260`.
The original SDK wrapper hid that RPC error; `reconcile-preview-rejection.js`
matched the captured node rejection to the saved broadcast journal and independently
checked the unchanged root and zero tally before the runner resumed.

## 1. Restore the supported build

Run commands from `midnight-passport-voting-poc`. Keep `.env.development` private;
do not regenerate the funded keys. The current host has the official Apple Silicon
compiler in `.local/toolchain/compactc-0.31.1/compactc`.

The pinned compiler archive is
[compactc 0.31.1 for aarch64 Darwin](https://github.com/midnightntwrk/compact/releases/download/compactc-v0.31.1/compactc_v0.31.1_aarch64-darwin.zip).
Its verified SHA-256 is
`57af9b0449aa96b2905ea3d7a175b6b42ab38d725612a9cb2d73eb4ef253cce2`.
For a different host, use its official release asset and verify its digest; do not
run this architecture-specific binary or substitute the latest compiler.

```sh
npm ci --ignore-scripts
npm run contract:compile
npm run contract:verify
npm run contract:test
npm run check
```

Compilation generates all four circuits' prover/verifier keys and ZKIR, then
records hashes in `compact/managed/voting/artifact-manifest.json`. `contract:verify`
fails if the source, compiler or any generated file has changed. Generated files
are ignored by Git. Do not recompile during a live contract operation; the compile
command refuses while the operation lock exists.

Versions follow the official [Preview compatibility matrix](https://docs.midnight.network/relnotes/support-matrix):
compiler 0.31.1, Compact runtime 0.16.0, Midnight.js 4.1.1, Wallet SDK 1.2.0,
ledger package 8.1.0 and proof server 8.1.0. The lockfile pins the JS dependencies.

## 2. Generate real proofs locally

```sh
npm run prover:start
npm run contract:prove
```

This invokes the compiled enrollment, open, YES, NO and close circuits with random
local secrets. It makes real `/prove` requests to the loopback proof server and
records timings, transaction hashes and local transition results in
`.local/proof-checks/`. It never broadcasts or spends DUST. These timings are one
machine's smoke test, not performance guarantees; the tamper-probe step performs
extra proving work.

**Important discovered limitation:** the ledger WASM package disables the Rust
`proof-verifying` feature. `wellFormed` and local `apply` do not establish contract
proof validity even if `verifyContractProofs = true`. The diagnostic intentionally
modifies a proof body and demonstrates this limitation. Its acceptance locally is
not an accepted attack on Preview. See the pinned
[WASM dependency configuration](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/ledger-wasm/Cargo.toml)
and [conditional verifier implementation](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/ledger/src/structure.rs).
The modified-proof Preview rejection above supplies separate network evidence;
it does not turn local WASM checks into cryptographic verification.

## 3. Inspect the existing deployment

```sh
npm run preview:status
```

This checks the Preview network, reads contract state from the indexer, compares
all four on-chain verifier keys with the local build, and rechecks the finalized
deployment receipt. It does not sync a wallet or submit anything.

`npm run preview:deploy` is the deployment command. With the current deployment
record it inspects the existing contract rather than deploying again. On a fresh
setup it restores the authority wallet, syncs it, persists separate contract
authority/maintenance secrets, builds, proves, balances with DUST, journals the
identifiers, broadcasts once, verifies finality/state and saves the deployment.
The fee guard is 100 test DUST per transaction. No real token transfer is intended.

Private material and encrypted SDK state live in owner-only, ignored
`.local/preview-voting/`; `.env.development` keeps the existing funded wallet seeds.
The local password is stored alongside the development secrets, so this does not
protect against a compromised host/account. It is not production key management.
Never upload this directory, log SDK private objects, or include it in the web app.

If `deploy-broadcast.json` exists without `deployment.json`, **do not delete it or
redeploy**. Inspect its exact identifiers and candidate address, reconcile finality
and restore the deployment record only from confirmed state. A stale operation lock
alone does not establish whether a process or transaction is still active.

## 4. Runner and remaining acceptance gates

`npm run preview:ballot` is the explicit, DUST-spending CLI flow. It runs separate
authority and voter workers, persists election-scoped issuance reservations, and
journals before broadcasting. It was used for the completed ballot above.
On this closed election it now audits all seven receipts and exits read-only with
`PREVIEW_BALLOT_ALREADY_FINALIZED_READ_ONLY`; it never restores workers or votes again.
Use `npm run preview:audit` for the same complete receipt inspection without a
submission flag, or `npm run preview:status` for just deployment/current state.
The runner is not a general recovery system. A matching issuance reservation may
resume only when the same commitment is requested, enrollment is still open,
on-chain membership is absent and no broadcast/confirmation journal exists.
This continues the original reservation; it does not generate another secret or
entitlement. Different commitments, unknown membership/journal status and mismatched
scope cannot resume. Any existing broadcast requires reconciliation, not deletion
or blind retries. Operation and actor locks serialize these decisions.

An unresolved modified-proof broadcast also blocks **all** later live actions.
The audit accepts a recorded rejection only when its exact network, contract,
identifiers and hash match the intent, and the saved result records an explicit
node rejection and unchanged-state check. Missing chain inclusion or a timeout
does not count as rejection. This is labeled recorded evidence, not a fresh RPC
rejection observed every time the page is opened.

### Local live panel

The default election remains `ELECTION-DEMO-2026-001`. The user approved the
separate `ELECTION-DEMO-2026-002` for a real browser broadcast acceptance run.
Select it explicitly in each process (the server passes it to both workers):

```sh
MIDNIGHT_ELECTION_ID=ELECTION-DEMO-2026-002 npm run preview:deploy
MIDNIGHT_ELECTION_ID=ELECTION-DEMO-2026-002 npm run start:preview
MIDNIGHT_ELECTION_ID=ELECTION-DEMO-2026-002 npm run preview:ui-ballot
MIDNIGHT_ELECTION_ID=ELECTION-DEMO-2026-002 npm run preview:audit
MIDNIGHT_ELECTION_ID=ELECTION-DEMO-2026-002 npm run preview:ui-check
```

Election 001 retains `.local/preview-voting/`; election 002 uses
`.local/preview-voting-002/`. Only these two approved IDs are accepted; no HTTP
parameter can select a different election or directory. Both use the existing
funded wallet seeds. `.local/preview-shared/operation-lock.json` serializes wallet
sessions and recompilation across elections. Do not remove a lock to bypass an
active or uncertain operation. A previously closed election remains read-only.

`preview:ui-ballot` is an explicitly opted-in real-network Playwright driver, not
an ordinary fixture test. It clicks consent and Run for each of ten fixed actions,
waits for actual completion, pauses three seconds at checkpoints and records
public results/screenshots under `.local/ui-checks/`. It stops at the first
unexpected or unknown outcome. `--from=<action>` is only for an explicitly
inspected/reconciled continuation, never an automatic retry. Completing it closes
002 permanently; rerunning cannot create another entitlement.

```sh
npm run start:preview
# In the app: Live Preview ballot → Check Preview state & receipts
npm run preview:ui-check
```

`start:preview` enables the local action API with `MIDNIGHT_LIVE_ACTIONS=1`.
Ordinary `npm start` leaves it read-only. The API accepts loopback clients, an
exact local Host and same-origin JSON writes with an explicit action header.
Each action also requires consent and the inspected contract address. It uses a
fixed command allowlist, one job at a time and a request-ID idempotency check.
No endpoint accepts seeds, credential secrets, Merkle paths, arbitrary circuits,
arbitrary recipients or shell commands. State and receipt responses project an
explicit public schema rather than returning SDK objects or private file contents.

For unfinished elections, select one permitted action, authorize it, then click
Run selected live step. Progress comes from worker IPC: wallet sync, real proving,
DUST balancing, submission and finality. Sync may take several minutes; there is
no fake percentage or autoplay. Leave the operation running after a lost response
and check its job/state before considering another action. Idle workers stop after
30 minutes, or through the Stop idle wallet workers button. Page navigation does
not cancel a submitted transaction. Both workers still run on one trusted host.

On the current closed election, all live action controls remain disabled. The
receipt walkthrough waits for each Next click and never resubmits anything.
`preview:ui-check` opens desktop/mobile Playwright contexts against the real local
app and Preview indexer, blocks all browser non-GET requests, verifies seven receipts
and the closed tally, and saves screenshots under `.local/ui-checks/`.
The separate `e2e/preview.spec.js` uses isolated fixtures to exercise consent,
job progress, failures and prevention of blind retries. Those fixture tests are
not claimed as on-chain broadcast tests.

Remaining work:

1. The authorized 002 browser broadcast acceptance run is complete. Both 001 and
   002 are now permanently closed. Further new live elections require an explicit
   scope decision; never delete issuance records or redeploy the same election to
   evade one-entitlement-per-election enforcement.
2. Expand interruption/recovery tests around actor startup, issuance reservations,
   indexer lag and server restarts. UI fixtures and read-only live checks have passed.
3. Extend real-verifier/network negative tests for cross-election proofs and
   unauthorized operations. Eight compiled-circuit tests cover logic, not the
   cryptographic verification missing from the WASM build.
4. Reconcile uncertain broadcast outcomes with authoritative receipts when they
   occur. Pre-broadcast issuance continuation and completed-run read-only replay
   are implemented; they do not resolve a transaction whose outcome is unknown.

The browser's developer inspector documents the local simulated read shape,
actual local authority request/response, redacted simulator vote request and
the distinct Compact signatures. The NFC animation performs no HTTP requests
and does not authorize a credential. A native NFC adapter is future work.

Passport NFC remains animation-only. Passport IDs and chip data never belong in
the Compact circuit or chain transaction. Public choices/live counters and wallet
or timing correlation remain limitations; this POC is not a secret tally or proof
of end-to-end election anonymity.
