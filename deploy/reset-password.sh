#!/usr/bin/env bash
#
# Resets a staff account's password directly in the database, bypassing the
# app entirely. For when every admin is locked out at once (the in-app
# "Reset password" button on Admin -> Staff accounts only helps if at least
# one admin can still sign in).
#
# This app has no email/SMS "forgot password" flow on purpose - it is a
# single-store internal tool with a handful of named accounts, and building
# that infrastructure costs more than it is worth at this scale. This script
# is the deliberate alternative: a one-line fix that needs server access,
# which whoever runs the store already has.
#
#   bash deploy/reset-password.sh --list
#   bash deploy/reset-password.sh admin 'a new password, 10+ characters'

set -euo pipefail

cd "$(dirname "$0")"

if [ "${1:-}" = "--list" ]; then
  docker compose exec -T studio node -e "
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATA_DIR + '/studio.db');
    for (const u of db.prepare('SELECT username, is_admin, is_active FROM users ORDER BY is_admin DESC, username').all()) {
      console.log(u.username + (u.is_admin ? ' (admin)' : '') + (u.is_active ? '' : ' (disabled)'));
    }
  "
  exit 0
fi

USERNAME="${1:?usage: reset-password.sh <username> <new-password>   or   reset-password.sh --list}"
PASSWORD="${2:?usage: reset-password.sh <username> <new-password>   or   reset-password.sh --list}"

if [ "${#PASSWORD}" -lt 10 ]; then
  echo "Password must be at least 10 characters - same floor the app itself enforces." >&2
  exit 1
fi

# Same scrypt scheme as server/auth/passwords.ts, duplicated here rather than
# imported: the running image only has the bundled dist/server.cjs, not the
# individual source modules, so there is nothing importable to reuse without
# also booting the whole server. Keep the two in sync if that file's
# parameters ever change.
docker compose exec -T -e RESET_USERNAME="$USERNAME" -e RESET_PASSWORD="$PASSWORD" studio node -e "
  const Database = require('better-sqlite3');
  const crypto = require('crypto');
  const { promisify } = require('util');
  const scrypt = promisify(crypto.scrypt);
  const N = 1 << 17, r = 8, p = 1;

  (async () => {
    const db = new Database(process.env.DATA_DIR + '/studio.db');
    const user = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(process.env.RESET_USERNAME);
    if (!user) {
      console.error('No user named \"' + process.env.RESET_USERNAME + '\". Run with --list to see existing accounts.');
      process.exit(1);
    }
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(process.env.RESET_PASSWORD, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
    const hash = ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('\$');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    console.log('Password reset for ' + user.username + '. Sign in immediately, no restart needed.');
  })();
"
