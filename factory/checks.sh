#!/usr/bin/env bash
# The repo's checks. Exit 0 only when the branch is fit to review.
# Runs with a job's worktree as the working directory. Non-interactive, no rewrites.
set -euo pipefail

npm ci --prefer-offline --no-audit --no-fund
npm run typecheck
npm run build
