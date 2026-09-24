#!/usr/bin/env bash
#
# One-shot bootstrap for a fresh Ubuntu server (Oracle Cloud, or any VPS).
#
# Installs Docker, opens the firewall, and clones the app. Safe to re-run.
#
#   curl -fsSL https://raw.githubusercontent.com/paymentrlj-bit/RL-Jewels-Photo-Studio/main/deploy/setup.sh | bash
#
# or, if you have already cloned:  bash deploy/setup.sh
#
# Override the branch with BRANCH=some-branch if you ever need to deploy
# something other than main.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/paymentrlj-bit/RL-Jewels-Photo-Studio.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$HOME/rl-studio}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
say "Updating packages"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git

# ---------------------------------------------------------------------------
say "Installing Docker"
if command -v docker >/dev/null 2>&1; then
  echo "Docker already installed - skipping."
else
  curl -fsSL https://get.docker.com | sudo sh
fi

# Lets this user run docker without sudo. Takes effect on next login, so the
# rest of this script still uses sudo where it needs to.
sudo usermod -aG docker "$USER" || true

# ---------------------------------------------------------------------------
say "Opening ports 80 and 443 in the server firewall"
#
# Oracle Cloud's Ubuntu images ship an iptables ruleset that REJECTs everything
# not explicitly allowed. Opening the ports in Oracle's web console security
# list is only HALF the job - miss this half and the site times out with no
# error message anywhere, which is the single most common way this setup fails.
#
# Inserting at the top (-I with no position) guarantees these land before the
# catch-all REJECT rule, whatever position it happens to sit at.
if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
      echo "  opened port $port"
    else
      echo "  port $port already open"
    fi
  done

  # Persist across reboots, or the rules vanish the first time the VM restarts.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save >/dev/null 2>&1 || sudo sh -c 'iptables-save > /etc/iptables/rules.v4' || true
fi

# Some images use ufw instead; harmless if it is not installed.
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 80/tcp >/dev/null
  sudo ufw allow 443/tcp >/dev/null
  echo "  ufw rules added"
fi

# ---------------------------------------------------------------------------
say "Fetching the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet origin "$BRANCH"
  echo "  updated $APP_DIR"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  echo "  cloned into $APP_DIR"
fi

# ---------------------------------------------------------------------------
say "Creating the settings file"
ENV_FILE="$APP_DIR/deploy/.env"
if [ -f "$ENV_FILE" ]; then
  echo "  $ENV_FILE already exists - leaving it alone."
else
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$ENV_FILE" <<ENVEOF
# ---- REQUIRED ----
# The domain you pointed at this server's IP.
STUDIO_DOMAIN=studio.example.com

# Generated for you. Do not change it - every staff member gets logged out if you do.
SESSION_SECRET=$SECRET

# The first admin password. Change this line before starting, then sign in and
# create a proper account for each staff member.
BOOTSTRAP_ADMIN_PASSWORD=change-this-now-please
BOOTSTRAP_ADMIN_USERNAME=admin

# ---- AI ----
# Without this photos still capture and queue, but nothing gets processed.
GEMINI_API_KEY=

# ---- OPTIONAL ----
ERP_MAPPING=generic
QUEUE_CONCURRENCY=2
OCR_SPACE_API_KEY=

# Counts each piece's fine detail from close-ups before enhancing (more
# accurate beads/stones/chains, a few US cents more per photo). Set to "off"
# to run a batch without it and compare.
DETAIL_INVENTORY=on

GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=

AXIOM_TOKEN=

# ---- OPS ----
# Dead-man's-switch monitoring (optional but recommended): auto-update.sh
# pings this URL at the end of every successful run. If a run is ever missed
# - most notably because the server itself hung, which is exactly what
# happened on 2026-09-22 - healthchecks.io notices the ping didn't arrive and
# emails you. Get a free ping URL (no card needed) at https://healthchecks.io
# - create a check, set its expected period to 10 minutes with a few minutes
# of grace, and paste the ping URL here.
HEALTHCHECKS_PING_URL=
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "  created $ENV_FILE with a generated SESSION_SECRET"
fi

# ---------------------------------------------------------------------------
cat <<DONE

------------------------------------------------------------------
Setup finished.

NEXT, in this order:

  1. Edit the settings file and set STUDIO_DOMAIN, BOOTSTRAP_ADMIN_PASSWORD
     and GEMINI_API_KEY:

       nano $ENV_FILE

  2. Confirm your domain already points at this server. From your laptop:

       ping studio.yourdomain.com

     It must answer with THIS server's public IP before the next step -
     Caddy asks Let's Encrypt for a certificate and that check will fail
     if DNS is not live yet.

  3. Start it:

       cd $APP_DIR/deploy
       sudo docker compose pull
       sudo docker compose up -d

     Pulls the image CI already built - no local build. If it fails with
     "unauthorized" or "not found", the GHCR package still needs to be made
     public once (see ORACLE_CLOUD_SETUP.md Part 5). Then open
     https://studio.yourdomain.com

  4. Set up nightly backups:

       bash $APP_DIR/deploy/backup.sh --install

------------------------------------------------------------------
DONE
