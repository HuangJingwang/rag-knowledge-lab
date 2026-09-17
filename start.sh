#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
fi
docker compose up -d --build --wait --wait-timeout 360
docker compose ps
printf '\n启动完成。使用 compose ps 显示的网站映射端口访问；默认 http://localhost:8018/\n'
