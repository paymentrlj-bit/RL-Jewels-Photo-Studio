#!/usr/bin/env bash
#
# Polls GitHub for new commits on main and redeploys automatically when one
# lands, so a code update reaches the live app without anyone connecting to
# the server by hand.
#
# Deliberately a poll, not a webhook receiver: a webhook would mean opening
# another inbound endpoint and managing a shared secret for a single-store
# app where a few minutes' delay costs nothing.
#
#   bash deploy/auto-update.sh            check once, deploy if behind
#   bash deploy/auto-update.sh --install  also schedule it every 10 minutes

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/rl-studio}"
BRANCH="${BRANCH:-main}"
LOG_FILE="${LOG_FILE:-$HOME/rl-studio-auto-update.log}"

if [ "${1:-}" = "--install" ]; then
  SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  LINE="*/10 * * * * bash $SCRIPT_PATH >> $LOG_FILE 2>&1"
  # Replace any existing entry for this script rather than stacking duplicates.
  ( crontab -l 2>/dev/null | grep -v -F "$SCRIPT_PATH" || true; echo "$LINE" ) | crontab -
  echo "Auto-update scheduled every 10 minutes. Log: $LOG_FILE"
  exit 0
fi

cd "$REPO_DIR"
git fetch origin "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  # The common case on every run - stay silent rather than filling the log
  # with a line every ten minutes forever.
  exit 0
fi

echo "[$(date -Is)] new commit(s) on $BRANCH: $LOCAL -> $REMOTE"

# Fast-forward only. Nothing ever commits on the server itself, so a merge
# that is not a fast-forward means something unexpected happened here and is
# worth failing loudly on rather than silently reconciling.
git merge --ff-only "origin/$BRANCH"

cd "$REPO_DIR/deploy"
docker compose up -d --build

echo "[$(date -Is)] deployed $REMOTE"
