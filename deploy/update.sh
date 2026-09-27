#!/usr/bin/env bash
# Обновить до последнего коммита ветки и перезапустить. Запускается автодеплоем или вручную.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/battleship}"
BRANCH="${BRANCH:-claude/epic-lovelace-vua5k7}"
cd "$APP_DIR"
git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
curl -fsS "http://127.0.0.1:80/healthz" -H "Host: $(grep '^DOMAIN=' .env | cut -d= -f2-)" >/dev/null && echo "healthz ok"
