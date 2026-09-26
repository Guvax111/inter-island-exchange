#!/usr/bin/env bash
# Nightly backup of the IIE staging database and product images. Run from cron on the server:
#   15 2 * * * /opt/iie/deploy/staging/backup.sh >> /var/log/iie-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
dir="${BACKUP_DIR:-/var/backups/iie}"
keep="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"
umask 077

# Custom-format dump: consistent snapshot, restorable table by table.
docker compose exec -T postgres pg_dump -U iie -d iie --format=custom --no-owner > "$dir/iie-db-$stamp.dump.partial"
mv "$dir/iie-db-$stamp.dump.partial" "$dir/iie-db-$stamp.dump"

# Product images live in the media volume, read through the api container.
docker compose exec -T api tar -C /data/media -czf - . > "$dir/iie-media-$stamp.tar.gz.partial"
mv "$dir/iie-media-$stamp.tar.gz.partial" "$dir/iie-media-$stamp.tar.gz"

# Verify the dump is readable before pruning old ones.
docker compose exec -T postgres pg_restore --list < "$dir/iie-db-$stamp.dump" > /dev/null
find "$dir" -name 'iie-*' -type f -mtime +"$keep" -delete
echo "$(date -u +%FT%TZ) backup ok: iie-db-$stamp.dump, iie-media-$stamp.tar.gz"
