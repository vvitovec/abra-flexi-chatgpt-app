#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/viktorvitovec/Documents/Local/Projekty/Abra API"

cd "$PROJECT_DIR"
exec node dist/index.js
