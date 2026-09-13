# Private Ballot: from simulator to Preview

## What exists now

- The local app runs the fictional passport authority and simulated voting verifier.
- The guided UI checks the two accepted ballots and three rejection outcomes, with an optional fictional NFC read included in the tour. Every step waits for the viewer by default.
- Preview voter and authority SDK wallets have real DUST-registration receipts in `.local/dust-registration/`. These receipts are not ballot receipts.
- `compact/Voting.compact` compiles, has eight compiled-logic tests, and is deployed on Preview. The CLI completed election 001, and ten real Playwright-driven browser actions completed the separately authorized election 002 on 2026-09-13. Both closed at YES 1 / NO 1, with authority rejections, local replay rejection and a network-rejected modified proof. The live panel uses real proofs and generated DUST; original animation buttons still use the simulator. The 002 browser run had zero page errors, seven independently checked finalized receipts and no unresolved journals. See [the Preview runbook](PREVIEW-RUNBOOK.md) for receipts, evidence boundaries and remaining gates; `.pseudo` is the older sketch.
- The app's credential secret crosses a local HTTP boundary during simulated voting. The future ZK implementation must remove that payload, not encrypt or hide it in a log.

## Implementation sequence and acceptance gates

### 1. Choose the security boundaries before writing circuits

Keep issuance and voting separate. The authority may know which identity received a credential and its commitment, but must not receive the voting secret, membership witness or ballot. The voter generates a fresh 256-bit secret per election and keeps it in device-private storage. A “voting token” here means an entitlement proven by knowledge of that secret, not a freely transferable NIGHT asset. Secret sharing/coercion is not prevented by this POC.

One credential per *document* is only the demo policy. A production authority must deduplicate by eligible person across replacement passports; two valid document numbers must not create two votes. No public permanent passport hash or permanent voter identifier.

The network checks a proof of credential membership, not passport validity. An off-chain authority must authenticate the document and apply eligibility/revocation policy. Never accept an unauthenticated client JSON flag such as `documentStatus: VALID` as evidence.

### 2. Real Compact contract and remaining verification

The compiled contract implements these responsibilities. Network call integration remains separate from passing compiled-logic tests:

| Operation | Who may call | Assertions and state changes |
| --- | --- | --- |
| Create | Election authority | Bind immutable election scope and authority authorization; empty enrollment set; counters zero |
| Enroll commitment | Authority only | Enrollment phase; valid unused commitment; update eligibility tree/root |
| Open voting | Authority only | Freeze the enrollment root; disallow further additions/replacements |
| Vote | Any valid credential holder | Voting phase; prove secret-backed membership against frozen root; bind nullifier to secret, election and contract; YES/NO only; unused nullifier; atomic tally and nullifier update |
| Close | Authority only | End voting; reject subsequent votes and enrollment; final tally readable |

Use the pinned Compact standard library for hashing/commitments and Merkle checks. Treat witness output as untrusted: the circuit must check its relationship to public state. The leaf, path index and secret must not be disclosed as public voting inputs. Bind the choice into the proven state transition so changing YES to NO invalidates the proof. Treat nullifier generation as a specified, domain-separated circuit operation, not string concatenation from the current simulator.

A single contract may own both logical eligibility and tally state for the first integration, avoiding cross-contract root synchronization. Keep the two responsibilities explicit. Authority-only means circuit-enforced authorization, not a disabled button or a check in the HTTP API. Review who can maintain/upgrade the contract as well as who can enroll and close.

Compile without skip-ZK flags for network deployment. Preserve source, compiler version, generated bindings, ZKIR, prover/verifier artifacts and hashes. Run compiled-circuit positive and negative tests before broadcasting. The existing Node domain tests do **not** test Compact or cryptographic soundness.

### 3. Make authority issuance crash-safe

The current in-memory Map is only a single-process simulation. Replace it with durable storage and a unique constraint on `(election, eligible identity)`:

1. Atomically reserve identity/election and the supplied commitment with a request ID.
2. Journal the pending chain transaction identifier before broadcast.
3. Publish the commitment using circuit-enforced authority authorization.
4. Verify finality and the actual updated root/commitment; only then mark issuance complete.
5. On timeout or restart, reconcile the same request/transaction. Do not mint a fresh secret/commitment or clear the reservation based only on a lost response.

Keep the device's pending secret recoverable locally before making the request. If issuance succeeded but the response was lost, the device must resume that exact credential. Do not let a copied app acquire the original secret merely by knowing the passport ID. Recovery beyond that resumable request is out of POC scope.

### 4. Wire providers and deploy to Preview

The official [deployment guide](https://docs.midnight.network/guides/deploy-and-operate) covers these six provider responsibilities: device-private state, indexed public state, compiled ZK artifacts, proof generation, wallet balancing/signing, and network submission. Its sample contract and network are examples, not this app's deployment. Adapt to the existing Preview keys without exposing `.env.development` to the web bundle.

The [support matrix](https://docs.midnight.network/relnotes/support-matrix), checked 2026-09-10, pairs Preview with Compact devtools 0.5.1, toolchain 0.31.1, runtime 0.16.0, Wallet SDK 1.2.0, Midnight.js/testkit-js 4.1.1, Indexer 4.3.5 and proof server 8.1.0. Verify the matrix again when implementing; don't mix “latest” packages from incompatible releases. The installed wallet/prover are not substitutes for the compiler and contract providers.

Deployment gates:

- Compile and test the contract; install compatible providers using the lockfile.
- Verify `system_chain` is Midnight Preview, the saved addresses have Preview prefixes, and the prover is local/trusted.
- Sync the authority wallet and check available DUST; retain the existing keys.
- Deploy with the intended authority authorization and election scope; journal before submission and verify finalized inclusion.
- Save a public deployment manifest containing network, contract address, election scope, deployment identifier, finalized block, toolchain versions and artifact hashes. Never save witness data or identity maps in that manifest.
- Query the deployed address through the indexer; do not display simulator state as the deployed state.
- Enroll both eligible credentials, confirm the root, then open voting. Vote from independent private credential stores. Wallet/fee sponsorship design needs a privacy review; two credential objects in one linked wallet are not anonymity evidence.

For now, the following existing commands are safe diagnostic/setup tools, **not deployment commands**:

```sh
npm run prover:start
npm run wallets:receipts
npm run check
npm run test:e2e
```

`npm run preview:status` now independently inspects the deployed contract; `npm run preview:deploy` uses the real SDK pipeline. Follow the [runbook](PREVIEW-RUNBOOK.md) before operating either command. The browser still simulates ballots.

### 5. Observe, test and reconcile

Track separate build, prove, wallet approval, submit and finality timestamps. Show elapsed time and the last confirmed phase, not fabricated progress percentages. Report median/p95 only after multiple measured runs with documented hardware, network, circuit size, and cold/warm proving artifacts. Animation pacing is not a benchmark.

Before broadcast, store a public transaction identifier plus operation intent. If submission is uncertain, show “outcome unknown” and reconcile by identifier; never blindly re-submit. On confirmation, query the actual contract state and assert the expected root, nullifier count and tally. Serialize/rebuild transactions on stale-state conflicts where appropriate, without changing the credential or its nullifier. A transaction's success receipt alone is not enough to attribute a later unrelated state change.

| Test | Expected result |
| --- | --- |
| P001 YES and P002 NO | Two credentials, two used nullifiers, tally 1–1 |
| P003 revoked / unknown document | No credential transaction and no vote |
| Same identity on two devices concurrently | One durable reservation/credential; other request rejected |
| Same credential votes twice / transaction resubmitted | At most one tally increment; reconcile the original outcome |
| Wrong election or contract / fake path / changed choice | Circuit proof fails or transaction rejected; no state change |
| Unauthorized enrollment, root replacement, open or close | Contract rejects; no state change |
| Enrollment after opening / vote after close | Contract rejects; frozen eligibility and tally preserved |
| Authority/prover/indexer unavailable | Explicit failed or unknown phase, no unconditional success and no blind retries |
| Authority crash after broadcast | Resume the same reservation; reconcile pending receipt |
| Stale root / concurrent valid votes | Defined stale-state recovery; no lost tally update or duplicate use |
| App reinstall | No new entitlement; lost private credential may be unrecoverable in v1 |
| Public-state and transaction inspection | No passport identifiers, secret, leaf index/path, NFC payload, or document-derived permanent identifier |

Re-run this matrix at three levels: simulator unit tests; compiled-contract/prover tests; and opt-in Preview integration tests with finalized receipts. Playwright covers browser orchestration and presentation, not cryptographic security or physical passports.

## NFC: what belongs in the native reader

### Following the simulated payloads

Select a fictional passport and use **Simulate NFC read**. The passport approaches the device, a reading phase holds for 1.8 seconds, then a local secret and commitment are prepared. Preparation grants no voting right and makes no HTTP request. Use **Verify & issue credential** separately to ask the mock authority for authorization.

The four data-boundary buttons beneath the animation open the corresponding developer panel. The highlight follows local reads and actual credential/vote HTTP calls; **View payloads** jumps to the latest active boundary. Selecting a panel is read-only and does not send a request. Panels retain the last exchange, including HTTP status and rejection JSON, for comparison.

- Local read: fictional snapshot, `documentStatus: UNKNOWN`; never a genuine chip result.
- Issuance: election ID in the URL, `{ demoPassport, commitment }` in the body. The response authorizes the locally prepared secret; it does not return a secret.
- Voting: the current simulator sends `{ choice, credentialSecret, proofDigest, proofMode }`. The inspector masks the secret only in its display. This is explicitly **not** the future Midnight transaction format.
- Public state: the actual `public` portion of `/api/state`, with no passport ID. It is simulator state, not a chain receipt.

The proposed Midnight inputs are shown separately as conceptual shapes. The compiled contract and SDK must supply the real encoding; do not implement a network client by copying illustrative JSON from the UI.

[ICAO Doc 9303](https://www.icao.int/publications/doc-series/doc-9303) specifies interoperable travel-document data and security mechanisms. [Part 11](https://www.icao.int/publications/documents/9303_p11_cons_en.pdf) describes secure access and authentication. The [ICAO validation requirements](https://www.icao.int/icao-pkd/epassport-validation-roadmap-tool-system-requirements) distinguish mandatory passive authentication from optional additional mechanisms.

The web demo has no genuine NFC transport. [Web NFC](https://developer.chrome.com/docs/capabilities/nfc) handles NDEF, not the ISO-DEP/APDU operations needed for a passport. A native reader can use an interface such as [Android IsoDep](https://developer.android.com/reference/android/nfc/tech/IsoDep), with an eMRTD protocol implementation on top. Platform-specific hardware work needs a chosen mobile platform, compatible phone, permissions and authorized test documents.

Native module stages:

1. Explain consent and the required attributes; obtain the document access information locally.
2. Detect the chip; perform BAC/PACE as supported and required by policy; maintain secure messaging.
3. Read DG1 and SOD, plus only further groups required by policy. DG1 supplies the document/holder fields; the radio UID is not the passport number. Do not read DG2 just because it is available.
4. Validate the SOD signature and certificate chain against a maintained trust store; validate hashes for the groups actually read. Handle expired/untrusted certificates explicitly. Do not call a mocked check “verified.”
5. Perform supported anti-copy authentication if policy requires it; fail closed when the required capability is unavailable.
6. Ask the authorized document-status/eligibility service about the required identifier/attributes. Passport expiry is not the same as revocation, replacement or election eligibility. Chip authentication is not a status lookup either.
7. Request the anonymous credential through the crash-safe authority flow. Release raw document buffers as soon as practical; managed memory cannot promise immediate forensic erasure.

Do not add free-form passport uploads or send real document numbers to the demo authority. Native acceptance tests should cover tag loss, wrong access data, session timeout, malformed DG1, changed data-group hashes, untrusted signer, required chip-auth failure, revoked/reissued documents and unavailable status service. This turn adds no real document processing.

## UX and browser test workflow

Run `npm run test:e2e` for Chromium desktop and mobile-viewport projects. Tests start an isolated server on port 4174, use fictional data, and never import `.env.development` or broadcast wallet transactions. The normal development app remains on 4173.

Default step mode waits indefinitely at each checkpoint. Comfortable autoplay allows six seconds of reading before a step; quick replay allows two. Pause waits after the current action; Next advances a checkpoint; Stop allows an in-flight action to settle and then prevents the next step. Reduced motion removes moving packets but retains their reading time. Manual actions are disabled using actual button state, including for keyboard users.

The full-flow test deliberately uses real animation time. Failure-only traces, screenshots and video are saved in git-ignored `test-results/`; the HTML report goes to `playwright-report/`. These traces are suitable only for fictional records: recordings can capture private request bodies and device state. Never run this recording setup on real passports or production credentials.

Use `npm run test:e2e:headed` to watch the tests, or `npx playwright show-report` afterward. Mobile viewport emulation does not constitute physical NFC testing or Safari compatibility testing.

## Privacy claims that remain out of scope

ZK alone does not prevent timing, IP, wallet or fee-payer correlation. A public counter update reveals an individual ballot's choice. Issuing and voting serially when only one voter is eligible can identify that voter trivially. Enroll an anonymity set before voting and review delayed/batched or private tallying and submission infrastructure before claiming unlinkability. The two-person final tally does not prove election anonymity, and a trusted authority can still issue unauthorized extra credentials unless its eligibility process is independently governed/audited.
