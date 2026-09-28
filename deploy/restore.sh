#!/usr/bin/env bash
# Восстановление данных из бэкапа на новом сервере (после install.sh).
# Использование: sudo bash /opt/battleship/deploy/restore.sh /root/battleship-backup-….tar.gz
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/battleship}"
SRC="${1:?укажи файл бэкапа}"
cd "$APP_DIR"
docker compose stop app
docker run --rm -v battleship_app-data:/data -v "$(dirname "$(readlink -f "$SRC")")":/in alpine \
  sh -c "rm -rf /data/* && cd /data && tar xzf /in/$(basename "$SRC") && if [ -f backup.sqlite ]; then mv -f backup.sqlite battleship.sqlite; rm -f battleship.sqlite-wal battleship.sqlite-shm; fi && ls -la /data"
docker compose start app
sleep 2
curl -fsS http://127.0.0.1:80/healthz -H "Host: $(grep '^DOMAIN=' .env | cut -d= -f2-)" && echo " — сервер поднялся, данные восстановлены"
