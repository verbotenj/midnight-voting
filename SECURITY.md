# Security boundaries

This is an experimental educational POC, not certified election software.
Use fictional documents and test-network assets only. No real passport/NFC dumps,
biometrics, production keys or mainnet funds belong in this repository.

- The NFC reader is an animation. It does not authenticate a real passport.
- The simulator sends its witness secret to a local HTTP verifier; hiding the
  value in the inspector is not cryptographic protection.
- The separate Preview flow generates real Compact proofs with a trusted local
  prover. Passport IDs and witness secrets are not public circuit arguments.
- Public choices, incremental tallies, wallet addresses, timing and shared-host
  access can correlate activity. This POC does not prove end-to-end anonymity.
- Ledger-v8's local WASM checks are not a cryptographic proof verifier. Distinguish
  compiled-logic checks, actual node rejection and finalized receipt evidence.
- Keep the app and proof server on loopback. They are not hardened hosted services.
- For public demonstrations, use `cloudflare/worker.js` or `public-server.js`: isolated disposable
  sessions, fictional IDs, allowlisted files and no live operations. See
  [hosting boundaries](docs/HOSTING.md). This is not a shared election authority.

Never commit `.env*` (except the blank template), `.local/`, private-state databases,
wallet seeds or SDK dumps. Private repository visibility is not secret storage.
The hygiene script is a guardrail, not a guarantee that every secret can be detected.

Report suspected vulnerabilities privately to the repository owner, @verbotenj.
Do not include wallet secrets or document information in an issue, pull request,
CI log or screenshot. If secrets are exposed, stop affected use and arrange key
replacement/recovery; deleting a file or making the repository private is not
sufficient remediation.
