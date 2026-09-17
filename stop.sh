#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose stop
printf '容器已停止，数据库数据卷保留。\n'
