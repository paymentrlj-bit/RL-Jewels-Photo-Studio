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
# Source (git) and the running app image are tracked separately on purpose.
# .github/workflows/publish.yml builds and pushes the image to GHCR on the
# same push that advances origin/main, but that build takes a minute or two
# - so on the cron tick that first sees the new commit, the image often
# isn't there yet. If this script only redeployed on a git-SHA change, that
# race would mean it deploys stale code once and then never retries, because
# the next tick sees git already caught up and stops looking. Instead the
# image pull runs unconditionally every tick, and Compose recreates the
# container only when the pulled image digest actually differs from what is
# running - so a slow CI build just means it lands one tick later, silently.
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

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date -Is)] new commit(s) on $BRANCH: $LOCAL -> $REMOTE"
  # Fast-forward only. Nothing ever commits on the server itself, so a merge
  # that is not a fast-forward means something unexpected happened here and
  # is worth failing loudly on rather than silently reconciling. This also
  # picks up any deploy/*.yml, Caddyfile, or script changes, not just the
  # app image.
  git merge --ff-only "origin/$BRANCH"
fi

cd "$REPO_DIR/deploy"

BEFORE="$(docker compose images -q studio 2>/dev/null || true)"
docker compose pull --quiet studio
AFTER="$(docker compose images -q studio 2>/dev/null || true)"

# up -d only recreates a container whose config or image actually changed,
# so this is cheap to run every tick even when nothing is new.
docker compose up -d

if [ "$BEFORE" != "$AFTER" ]; then
  echo "[$(date -Is)] deployed new studio image ($BEFORE -> $AFTER)"
fi
