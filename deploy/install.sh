#!/usr/bin/env bash
# Установка на чистый Ubuntu/Debian VPS. Можно запускать повторно — обновит и перезапустит.
#   curl -fsSL https://raw.githubusercontent.com/yangorovet-lab/mb/claude/epic-lovelace-vua5k7/deploy/install.sh | sudo bash -s -- <домен-или-IP>
set -euo pipefail

REPO="${REPO:-https://github.com/yangorovet-lab/mb.git}"
BRANCH="${BRANCH:-claude/epic-lovelace-vua5k7}"
APP_DIR="${APP_DIR:-/opt/battleship}"
DOMAIN_ARG="${1:-}"

if [ "$(id -u)" -ne 0 ]; then echo "Запусти от root: sudo bash install.sh <домен>"; exit 1; fi

wait_for_apt() {
  # на свежем VPS unattended-upgrades держит блокировку несколько минут
  local waited=0
  while fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1 \
        || pgrep -x unattended-upgr >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; do
    if [ "$waited" -eq 0 ]; then echo "== Ждём, пока система закончит фоновые обновления (apt занят)…"; fi
    sleep 5; waited=$((waited + 5))
    if [ "$waited" -ge 900 ]; then echo "apt занят уже 15 минут. Останавливаем unattended-upgrades."; systemctl stop unattended-upgrades 2>/dev/null || true; killall unattended-upgr 2>/dev/null || true; sleep 3; break; fi
  done
}

if ! command -v docker >/dev/null 2>&1; then
  echo "== Ставим Docker"
  wait_for_apt
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin не найден. Установи docker-compose-plugin и запусти снова."; exit 1
fi
command -v git >/dev/null 2>&1 || { wait_for_apt; apt-get update -qq && apt-get install -y -qq git; }

if [ -d "$APP_DIR/.git" ]; then
  echo "== Обновляем код в $APP_DIR"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  echo "== Клонируем в $APP_DIR"
  git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

if [ -n "$DOMAIN_ARG" ]; then
  DOMAIN="$DOMAIN_ARG"
elif [ -f .env ] && grep -q '^DOMAIN=' .env; then
  DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2-)"
else
  IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
  DOMAIN="${IP}.sslip.io"
  echo "== Домен не указан, используем $DOMAIN"
fi
echo "DOMAIN=$DOMAIN" > .env

echo "== Открываем порты (если есть ufw)"
if command -v ufw >/dev/null 2>&1; then ufw allow 80/tcp >/dev/null || true; ufw allow 443/tcp >/dev/null || true; ufw allow 443/udp >/dev/null || true; fi

echo "== Собираем и запускаем"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

echo
echo "Готово. Игра: https://$DOMAIN/"
echo "Проверка: curl -s https://$DOMAIN/healthz"
echo "Логи: docker compose -f $APP_DIR/docker-compose.yml logs -f app"
