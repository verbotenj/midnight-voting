# Privacy lens · September 16, 2026

## What changed

- A separate `/privacy` page switches between voter, passport-authority and public-chain perspectives. Selected example fields are illustrative, not live payloads or complete transaction schemas.
- The lens reads no credentials or application storage and makes no requests when switching perspectives. Keyboard controls, direct navigation, mobile layout and browser-back navigation have coverage.
- Privacy limitations are explicit: Compact discloses ballot choices; the trusted prover sees witnesses; wallet/timing metadata can correlate activity. The hosted non-ZK simulator can link fictional identities to choices.
- An expired walkthrough session now explains how to recover instead of incorrectly instructing public visitors to start a local server.

## Focused review scope

Reviewed navigation/static-route parity across local Node, hosted Node and Workers;
the new page's DOM construction and data sources; reset failure handling; and
explanation consistency with `compact/Voting.compact` and issuer code. No contract,
wallet, credential issuance policy or proof implementation was changed. This was
a focused functional/privacy-copy review, not an independent security audit.

## X draft — not posted

New in my Midnight voting POC: Privacy Lens 🔍

Switch between voter, authority & public-chain views. See what’s disclosed—and the limits.

Fictional passports. Hosted simulation, not real ZK.

@IOHK_Charles, feedback welcome!
https://midnight-voting.verbotenj.workers.dev/privacy

Handle cross-checked against [Charles Hoskinson's GitHub profile](https://github.com/charleshoskinson).
