#!/usr/bin/env bash
#
# Backs up the studio data volume - the database and every photo.
#
# This is the most important script in the repository. Everything else can be
# rebuilt from git; this cannot be rebuilt from anything.
#
#   bash deploy/backup.sh            run a backup now
#   bash deploy/backup.sh --install  also schedule it nightly at 2am

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/rl-studio-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
VOLUME="${VOLUME:-deploy_studio-data}"

if [ "${1:-}" = "--install" ]; then
  SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  LINE="0 2 * * * bash $SCRIPT_PATH >> $HOME/rl-studio-backup.log 2>&1"
  # Replace any existing entry for this script rather than stacking duplicates.
  ( crontab -l 2>/dev/null | grep -v -F "$SCRIPT_PATH" || true; echo "$LINE" ) | crontab -
  echo "Nightly backup scheduled at 02:00. Log: $HOME/rl-studio-backup.log"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
ARCHIVE="$BACKUP_DIR/studio-$STAMP.tar.gz"

echo "[$(date -Is)] backing up volume $VOLUME"

# Reads the volume through a throwaway container, so this works whether or not
# the app is running and never needs root on the host filesystem.
#
# SQLite is in WAL mode, so a copy taken while the app is running is
# recoverable. Copying while stopped is cleaner, but a nightly backup that
# needs downtime is a nightly backup that stops happening.
docker run --rm \
  -v "$VOLUME":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine:3 \
  tar czf "/backup/$(basename "$ARCHIVE")" -C /data .

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[$(date -Is)] wrote $ARCHIVE ($SIZE)"

# Prune old archives so the disk does not slowly fill and take the app down
# with it - which would be a backup script causing an outage.
find "$BACKUP_DIR" -name 'studio-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] pruned archives older than $KEEP_DAYS days"

cat <<'NOTE'

NOTE: this backup is on the SAME server as the data it is protecting. That
covers a bad deploy or an accidental delete - it does NOT cover losing the
server. Copy the newest archive somewhere else regularly:

    scp -i your-key.pem ubuntu@<server-ip>:~/rl-studio-backups/studio-*.tar.gz .

or install rclone and sync the folder to Google Drive.
NOTE
