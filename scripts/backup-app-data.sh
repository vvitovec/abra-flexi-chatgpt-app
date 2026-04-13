#!/usr/bin/env bash
set -euo pipefail

APP_DATA_DIR="${APP_DATA_DIR:-.chatgpt-app-data}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/flexi-chatgpt-app-$STAMP.tar.gz" "$APP_DATA_DIR"
echo "Backup created: $BACKUP_DIR/flexi-chatgpt-app-$STAMP.tar.gz"
