# Development workflow

Maintainer and default contributor: [@verbotenj](https://github.com/verbotenj).
This is a single-developer repository. Use short-lived branches for larger work;
small, tested, scoped commits may go directly to `main`. No mandatory second
reviewer or self-approval is required. CI never submits network transactions.

## Fresh clone

Use Node 24, npm, Git and `unzip` on macOS or Linux (Windows: WSL2).

```sh
npm ci --ignore-scripts
npm run contract:setup
npm run contract:compile
npm run check
npm run contract:test
npx playwright install chromium
npm run test:e2e
```

The compiler installer pins version 0.31.1 and verifies the official archive's
SHA-256. Compilation creates ignored artifacts; no compiled binaries, wallet
files or private election data are shipped in Git. Never recompile while a live
operation uses those keys. Local source-only simulation needs just `npm start`.

## Before a commit

```sh
git status --short
git add <explicit-related-files>
npm run repo:check
git diff --cached --check
git diff --cached --stat
git commit -m "feat(scope): describe the change"
git push
```

Prefer scoped `feat`, `fix`, `test`, `docs` and `chore` commits. Do not force-add
ignored files. Review diffs locally for secrets before pushing. Configure identity
per repository, not globally:

```sh
git config user.name verbotenj
git config user.email 20187617+verbotenj@users.noreply.github.com
```

Live Preview operations are explicitly opted in and separate from CI. Follow
[the runbook](docs/PREVIEW-RUNBOOK.md); do not regenerate existing funded seeds,
delete issuance journals, reuse a closed election, or retry uncertain broadcasts.
Keep `.env.development` and `.local/` backed up securely outside Git. Cloning this
repository does not recover existing voting credentials or deployment journals.
