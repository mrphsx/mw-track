#!/bin/bash
# Бэкап PostgreSQL — запускать по cron (см. server-setup.sh).
set -e

BACKUP_DIR="/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="trafficcrm_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/$FILENAME"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Бэкап создан: $FILENAME"
