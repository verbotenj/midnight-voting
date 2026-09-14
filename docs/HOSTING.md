# Public simulation on Render

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
