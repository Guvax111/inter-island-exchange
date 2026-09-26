#!/usr/bin/env bash
# Restores a backup made by backup.sh. Replaces ALL current staging data.
#   ./restore.sh /var/backups/iie/iie-db-20260926T021500Z.dump [/var/backups/iie/iie-media-20260926T021500Z.tar.gz]
set -euo pipefail
cd "$(dirname "$0")"
db="${1:?usage: restore.sh <db.dump> [media.tar.gz]}"
media="${2:-}"
read -r -p "This replaces all staging data with $db. Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled"; exit 1; }

docker compose stop api worker web
docker compose exec -T postgres dropdb -U iie --if-exists iie
docker compose exec -T postgres createdb -U iie iie
docker compose exec -T postgres pg_restore -U iie -d iie --no-owner --exit-on-error < "$db"
if [ -n "$media" ]; then
  docker compose run --rm --no-deps -T --entrypoint sh api -c 'find /data/media -mindepth 1 -delete && tar -C /data/media -xzf -' < "$media"
fi
docker compose up -d
echo "Restored from $db"
