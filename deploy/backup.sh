#!/usr/bin/env bash
# Бэкап данных игры (SQLite: игроки, результаты вызова дня, история партий).
# Использование: sudo bash /opt/battleship/deploy/backup.sh [файл.tar.gz]
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/battleship}"
OUT="${1:-/root/battleship-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"
cd "$APP_DIR"
# консистентная копия базы через sqlite .backup внутри контейнера, затем архив тома
docker compose exec -T app node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/data/battleship.sqlite');
db.exec(\"VACUUM INTO '/data/backup.sqlite'\");
console.log('snapshot ok');" 2>/dev/null || echo "снимок базы не сделан (контейнер не запущен?), берём файлы как есть"
docker run --rm -v battleship_app-data:/data -v "$(dirname "$OUT")":/out alpine \
  sh -c "cd /data && tar czf /out/$(basename "$OUT") ." 
docker compose exec -T app rm -f /data/backup.sqlite 2>/dev/null || true
echo "Бэкап: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Перенести на другой сервер: scp $OUT root@НОВЫЙ_IP:/root/"
