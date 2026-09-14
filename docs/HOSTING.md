# Public simulation hosting

## Cloudflare Workers — preferred, no-card free plan

Public demo: <https://midnight-voting.verbotenj.workers.dev>.
The connected GitHub integration deploys `main`; non-production branch builds
are disabled. The build token is restricted to this account's Workers Scripts
Edit and Account Settings Read, plus user Memberships Read and User Details Read.
Workers editing is account-scoped, not restricted to this one Worker. The token
is managed by Cloudflare Builds and is not stored in this repository.

The UI and API deploy together as a Worker with static assets. The public runtime
imports only the fictional domain model, Node-compatible hashing, and Cloudflare
storage APIs. There is no Midnight SDK, prover, wallet binding, or live-chain route.

```sh
npm ci --ignore-scripts
npm run check:cloudflare
npm run build:cloudflare
npm run test:cloudflare
```

`npm run dev:cloudflare` runs the Worker and SQLite-backed Durable Object locally
on port 4176. `npm run deploy:cloudflare` publishes with an already-authorized
Cloudflare CLI account. The CLI wrapper disables dotenv loading and strips Midnight
environment variables. Never upload `.env*`, `.local`, `.dev.vars`, or wallet files.

In the Cloudflare dashboard, create a Worker from GitHub, grant repository access
only to `verbotenj/midnight-voting`, and select `main`. Worker name: `midnight-voting`.
Use `npm run check:cloudflare && npm run build:cloudflare` as the build command and `npm run deploy:cloudflare`
as the deploy command. Keep the Workers Free plan; no paid add-ons or domain purchase
is needed. `wrangler.jsonc` defines the assets and SQLite Durable Object migration.

Cloudflare Git integration can deploy each push to `main`. This does **not** by
itself wait for the separate GitHub Actions workflow. For CI-gated deployments,
run the required checks in the Cloudflare build command or configure a GitHub
Actions deploy job after validation, using an owner-approved scoped Cloudflare
token stored as a GitHub secret. Do not claim CI gating until it is configured.
The Cloudflare build runs simulation tests only. The full `npm run check` includes
Preview inspection tests that require generated Compact artifacts; GitHub CI
compiles those artifacts before running the full suite. Never substitute the full
test command into a clean hosting build without its compiler setup steps.

One bounded Durable Object coordinates up to 250 independent browser sessions.
SQLite transactions serialize issuance/nullifier checks and mutations; state
survives object restarts. Each session expires after one hour idle; request-time
cleanup and a 15-minute alarm remove expired live rows. Platform backups may outlive
application expiry. Only fictional IDs, commitments, nullifiers, tallies, and
bounded demo events are stored—not the submitted synthetic credential secret.
Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. Each session is limited
to 120 API requests/minute; the coordinator is capped at 2,400/minute. These are
demo guardrails, not an abuse-proof quota guarantee or production election design.

The Free plan has resource quotas. If they are exhausted, the demo can become
unavailable; do not upgrade automatically. SQLite-backed Durable Objects support
the Free plan. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
and [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/).

To verify an owner-approved deployed simulation, run
`CLOUDFLARE_TEST_URL=https://<actual-worker-host>.workers.dev npm run test:cloudflare`.
Tests use fresh isolated cookies, not another visitor's election.

## Render — alternative

Host the UI and Node API together. GitHub is the public source repository; GitHub
Pages is not used. `render.yaml` selects the Free web-service plan explicitly.

- Build: `npm ci --omit=dev --ignore-scripts`
- Start: `npm run start:public`
- Health check: `/health`
- Node: 24.16.0; `HOST=0.0.0.0` on Render; Render supplies `PORT` and `RENDER_EXTERNAL_URL`.
- No environment secrets, wallet funding, Docker, Compact compiler, or database.
- Blueprint automatic deploys wait for GitHub checks to pass. A service imported
  using **Public Git Repository** can instead use **Auto-Deploy: Off**; deploy
  manually after local/GitHub checks pass, without granting GitHub account access.

Create a Render Blueprint from this repository's `render.yaml`, or use a Free
Node Web Service with the settings above. When deploying manually, set the public
origin using Render's automatically supplied external URL. Do not enable paid
resources. Account email verification and GitHub connection may require the owner.
Render may also request payment-card verification even when Free is selected;
the owner must complete that step if they choose to proceed. Never enter payment
details or switch to a paid plan as part of automated deployment.

## Boundaries

`public-server.js` imports only Node standard-library modules and the fictional
domain model. It never imports the Preview SDK/runtime, reads `.env` or `.local`,
or starts a wallet/prover. All Preview and network APIs return
`LIVE_OPERATIONS_DISABLED`. Static routes use an explicit allowlist. The hosted UI
replaces live controls with links to historical public receipts.

The authority is a real HTTP simulation but not a government service. Only the
three exact fictional passport IDs are accepted. The simulator's vote request
contains its synthetic credential secret; this is **not ZK**. Do not enter real
passport data or upload real credentials. Request bodies are not logged by this
application. Render still receives ordinary hosting/network metadata.

Each browser gets an unguessable HttpOnly, SameSite=Strict session cookie (Secure
on HTTPS). Sessions have independent authority state and tallies, capped at 250
concurrent sessions with one-hour idle expiry and bounded request rates. Clearing
cookies, changing browsers, or restarting the service starts a new simulation.
**One-issuance rules apply inside each demonstration, not across public visitors.**

On server/session expiry, an old mutation is rejected; it is never silently
replayed against a new election. Refresh establishes a new session version and
clears stale synthetic browser credentials. Local development wallets and real
election records are unaffected.

Render Free sleeps after 15 minutes without traffic and may take about a minute
to wake up. Memory and filesystem changes do not survive restarts. Open the demo
before a presentation. This is disposable demo infrastructure, not election
storage. See [Render Free](https://render.com/docs/free).

## Checks

`npm run check` includes public-server isolation, origin/CSRF, expiry, capacity,
rate-limit and route exposure checks. `npm run test:public` runs the complete
ten-step hosted demonstration on desktop/mobile against port 4175 while verifying
that another visitor is untouched and no live API is called.

Before making a private repository public, run `npm run repo:check` and
`node scripts/audit-publication.js --github`. The latter scans reachable Git
history, source and Actions logs for common patterns and known local wallet/
credential secrets without printing the secrets. Review unexpected artifacts
separately; automated scanning cannot guarantee absence of all sensitive data.
