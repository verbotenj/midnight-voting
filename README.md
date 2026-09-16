# Midnight Voting

[Open the public simulation](https://midnight-voting.verbotenj.workers.dev) — fictional passports only; no live blockchain submissions.

New: [Privacy lens](https://midnight-voting.verbotenj.workers.dev/privacy). Switch
between voter, authority and public-chain perspectives to see selected disclosed
and private fields. It is a read-only illustration, not a live data feed. Public
choices, prover trust and the hosted simulator's non-ZK boundary remain explicit.

A fictional passport-eligibility demo and proof-backed voting POC on **Midnight
Preview**.

Two valid demo passports receive one election-scoped credential each; a revoked
document receives none. Valid credentials can vote once. Passport IDs do not enter
the Compact contract. This is experimental software, not a certified election
system or an end-to-end anonymity guarantee.

## Start the animated demo

Use Node 24 and npm. No wallet, faucet, passport or Docker is needed for simulation.

```sh
git clone https://github.com/verbotenj/midnight-voting.git
cd midnight-voting
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:4173**. Select **Start walkthrough**, then **Run this step**
for each of the ten steps. There is no autoplay. Reset affects only the local
simulation. The focused Demo page shows one animation at a time; **Learn** holds
the explanations, **Developer** has manual controls and payload inspection, and
**Live Preview** has real-chain audit and explicit test-transaction tools.

The fictional NFC animation shows passport → device → reading → local credential
preparation. Reading alone issues no voting right and supplies no authoritative
`documentStatus`. **Verify & issue credential** contacts the mock authority.
Use only `DEMO-P001`, `DEMO-P002`, and revoked `DEMO-P003`.

On the **Developer** page, expand **Developer view · what gets sent, and in what shape?** for local adapter
types, actual simulator HTTP requests/responses, and the separate Compact circuit
signatures. Simulator witness values are hidden in the inspector, but still cross
the simulator's local voting HTTP boundary. The local adapter shape is not an
NFC standard or the Midnight SDK's serialized transaction format.

## Simulation versus real Preview

| Surface | What actually happens |
| --- | --- |
| Animated tour / manual demo | Fictional authority, hash-based educational verifier, simulated ledger; no chain broadcast |
| Live Preview ballot panel | Local SDK workers, trusted loopback prover, real Compact proofs, DUST fees and finalized transactions |
| Browser wallet lab | Optional test-token self-transfer through an installed wallet; not a ballot or voting entitlement |

The original author-host runs completed two separate real Preview elections:

| Election | Final result | Final block |
| --- | --- | --- |
| `ELECTION-DEMO-2026-001` | CLOSED · YES 1 / NO 1 | 829577 |
| `ELECTION-DEMO-2026-002` | CLOSED · YES 1 / NO 1 | 842563 |

Election 002 completed ten real browser-driven actions with seven finalized
receipts, a node-rejected modified proof, copied-app/revoked-document denial and
local duplicate-vote rejection. Exact public contract addresses, transaction IDs
and evidence boundaries are in [the Preview runbook](docs/PREVIEW-RUNBOOK.md).
These are recorded test runs, not claims that CI broadcasts new elections.

**Fresh clones do not contain wallet keys, credentials or receipt journals.**
Historical contracts cannot be reset or reused for fresh credentials. The live
panel needs the original local records to audit those deployments; it will report
unavailable state without them. Do not copy someone else's private state or deploy
another instance of a closed election to bypass one-credential-per-election rules.

## Engineering setup and tests

The project uses plain browser JavaScript and a Node HTTP server; no frontend
bundler is required. Full tests need the generated Compact artifacts:

```sh
npm run contract:setup     # Download checksum-verified Compact 0.31.1
npm run contract:compile   # Generate local circuit artifacts and keys
npm run contract:verify
npm run check
npm run contract:test
npx playwright install chromium
npm run test:e2e
```

Compiler setup supports macOS and Linux, ARM64 and x64; Windows developers can use
WSL2. `unzip` is required. The SDK/compiler dependencies are pinned. CI performs
these checks without wallets, a proof server, passport data or live transactions.
Playwright fixtures run on their own server at **4174**, separate from the demo.

Passing compiled-circuit tests does not prove cryptographic verification:
ledger-v8's WASM lacks that verifier feature. Real proof generation requires the
trusted local prover; successful inclusion or an explicit Preview rejection is
distinct evidence. See [acceptance status](docs/ACCEPTANCE-STATUS.md).

## Opt-in live development

For a public, simulation-only deployment, use Cloudflare Workers Free with
`wrangler.jsonc` (UI + API + isolated, temporary SQLite-backed demo sessions).
`render.yaml` remains an alternative Node hosting configuration. Both disable
all live operations. See [public hosting](docs/HOSTING.md). Never host `server.js`
publicly or upload your local `.env` / `.local` data.

Read [the runbook](docs/PREVIEW-RUNBOOK.md) before sending transactions. On an
existing funded development machine, **preserve its seeds and journals**.

- `npm run wallets:init` creates independent test-only wallets only when no
  `.env.development` exists; it refuses to overwrite existing state.
- `npm run wallets:show` prints verified public addresses only.
- `npm run prover:start` starts proof-server 8.1.0 on `127.0.0.1:6300` using Docker.
- Funding and DUST registration are separate opt-in operations. Never send real assets.
- `npm run start:preview` enables live local controls; ordinary `npm start` leaves
  those controls read-only. Every live step requires fresh explicit consent.
- `MIDNIGHT_ELECTION_ID` selects a fixed approved local election directory. The
  default is 001; 002 is separate. New live election scopes require an explicit
  development decision. Do not erase an old issuance record to start over.

Wallet sync can take several minutes. The UI reports actual sync, proving,
submission and finality, not fabricated progress. On an unknown outcome, reconcile
the original transaction; do not blindly retry or delete the broadcast journal.
The CLI and real-browser acceptance commands are not part of ordinary CI.

## Repository layout

```text
public/           Animated voter/authority UI, payload inspector, live panel
server.js         Loopback server and separated simulation/live APIs
lib/              Domain, issuance, wallet, actor, storage and receipt logic
compact/          Compact source and retained historical pseudocode
scripts/          Compiler setup, wallet/Preview tooling, explicit live checks
test/, tests/     Unit and domain tests
contract-tests/   Compiled Compact logic tests
e2e/              Isolated desktop/mobile browser tests
docs/             Engineering explanation, acceptance evidence, Preview runbook
.github/          CI and single-developer ownership
```

## Privacy and scope

No real NFC reading, government integration, biometrics or document database is
implemented. Current document validity must come from an authoritative status
service, not merely a signed historical passport chip.

The live contract contains no passport IDs, names, birth dates, photographs or
credential secrets. However, choices and live tallies are public; wallet metadata,
timing and the shared development host can correlate activity. This is **not** a
production secret-ballot system. The trusted local prover receives private witness
data; it must not be exposed as an untrusted remote service.

See [SECURITY.md](SECURITY.md),
[the engineering overview](docs/ENGINEERING.md), and
[the attack matrix](ATTACK_MATRIX.md). Secrets, generated artifacts, dependency
folders and test output are excluded from Git.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Third-party dependencies
retain their respective licenses.
