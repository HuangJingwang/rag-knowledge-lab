# 验证记录

2026-09-17，在 Docker Desktop 的 Linux amd64 容器中验证。使用独立项目 `rag-demo-bundle`、新建命名数据卷；原 `rag-sharing-demo` 与 8018 上的本机服务保持运行。

本机验证端口：网站 18018、Attu 18000、Neo4j HTTP 17474、Bolt 17687。部署包不包含这份本机 `.env`；默认端口见 `.env.example`。

- 完整 Docker 构建成功，固定 Python 依赖的 `pip check` 通过。
- init 从空数据库导入 30 个 Chunk、66 个节点、126 条关系；网站等待 init 成功后启动。
- `/`、`/explore`、`/entities`、`/examples` 页面正常；`/article/` 与打包文章字节一致。
- BGE 中文模型实际计算 512 维查询向量，Milvus 返回结果，Neo4j 返回向量命中与关系扩展。
- 九个文章案例全部通过，包括 LightRAG 实体／关系两路真实索引查询、Neo4j 真实路径、时序失效边界及 PageIndex 章节范围。
- 单独以 `docker run --network none` 启动镜像，LightRAG 两路索引查询成功；模型与 tokenizer 使用包内缓存，LLM 调用为 0。
- Attu 与 Neo4j Browser HTTP 返回 200；网站导航指向配置后的管理端口。
- 整套容器停止后，以 `--no-build --pull never` 再次启动，全部健康；重新导入后数据仍为 30 / 66 / 126，没有重复膨胀。
- 网站以非 root 用户 `demo` 和 Gunicorn 运行；未依赖宿主机虚拟环境、原目录挂载或原环境凭证。

镜像标识和文章 SHA-256 见 `build-manifest.json`。未在另一台实体设备或 ARM 原生容器上实测；镜像离线导出脚本已提供，但普通 ZIP 不包含基础镜像。
