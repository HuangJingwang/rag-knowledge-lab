#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -f rag-demo-images.tar.gz ]; then
  printf 'rag-demo-images.tar.gz 已存在，请先改名保存再导出。\n' >&2
  exit 1
fi
docker compose build web
docker compose pull etcd minio milvus neo4j attu
# Write the tar first so a failed docker save cannot be hidden by a pipeline.
docker image save -o rag-demo-images.tar \
  rag-demo-web:20260917 neo4j:5.26-community milvusdb/milvus:v2.6.4 \
  zilliz/attu:v2.6.5 quay.io/coreos/etcd:v3.5.18 minio/minio:RELEASE.2024-12-18T13-15-44Z
gzip rag-demo-images.tar
printf '已生成 rag-demo-images.tar.gz。目标电脑 docker load -i 后可无构建启动。\n'
