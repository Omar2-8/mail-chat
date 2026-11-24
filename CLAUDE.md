# Mail Chat

Electron + React + TypeScript app (Outlook mail as group chats).

## Setup and validation
- Fresh checkout: `npm ci`
- Dev UI on a port: `npx vite --config vite.config.mts --port <port> --strictPort`
- Checks (same as `factory/checks.sh`): `npm run typecheck` and `npm run build`

## Software factory

`/factory run` builds every open GitHub issue labeled `factory` through
intake -> spec -> build -> gate -> review -> approve, one PR per issue. State is in
`factory/jobs/` (gitignored); `factory/bin/job` is its only writer. Checks:
`factory/checks.sh`. Dashboard: `cd factory && python3 -m http.server`, then
open http://localhost:8000/dashboard.html.

The approver always escalates here: every PR waits for a human to merge it.

Each job works in its own git worktree, a full checkout of the repo at
`.worktrees/<job-id>` (gitignored). A tool run from the repo root that doesn't
read `.gitignore` sees those copies too; exclude `.worktrees/` in its config.
