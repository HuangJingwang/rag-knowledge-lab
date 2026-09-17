# RAG Knowledge Lab · Docker 部署说明

这是一份独立快照，包含原文阅读工作区、检索与关系图、九个文章案例、完整技术文章、虚构语料，以及本地中文 Embedding 模型。无需安装宿主机 Python，也不需要填写模型 API Key。

## 一键启动

需要 Docker Engine / Docker Desktop 和 Docker Compose v2 或更新版本。建议给 Docker 分配至少 8 GB 内存，并预留 10 GB 以上磁盘空间。本包验证平台为 Linux amd64；Apple Silicon 可由 Docker Desktop 模拟运行，速度会有差异。

克隆仓库或解压部署包后，进入项目根目录：

```sh
./start.sh
```

首次会复制 `.env.example` 为 `.env`，构建网站镜像、启动数据库、写入演示数据，然后启动网站。首次构建需要联网拉取 Python 包和 Docker 镜像；BGE 模型权重已随部署包携带，不需重新下载。

Windows 或希望直接使用 Compose 时：

```sh
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 360
```

PowerShell 的复制命令可用 `Copy-Item .env.example .env`。构建耗时与网络有关，360 秒是构建之后等待服务就绪的上限。

| 默认入口 | 内容 |
| --- | --- |
| http://localhost:8018/ | 原文工作区、Chunk 标注、提问与证据定位 |
| http://localhost:8018/article/ | 完整技术文章，所有插图内嵌 |
| http://localhost:8018/examples | 九种技术案例 |
| http://localhost:8018/entities | LightRAG 实体、关系与来源 |
| http://localhost:8000/ | Attu：查看 Milvus 数据；连接 `milvus:19530`，无需认证 |
| http://localhost:7474/browser/ | Neo4j Browser：连接 `bolt://localhost:7687` |

Neo4j 用户名为 `neo4j`，密码见 `.env` 的 `NEO4J_PASSWORD`。示例文件中的密码只用于这套虚构演示数据，可在首次启动前修改。数据库已有数据卷后，仅修改环境变量不会重置已有数据库密码。

端口冲突时修改 `.env` 中的 `WEB_PORT`、`ATTU_PORT`、`NEO4J_HTTP_PORT`、`NEO4J_BOLT_PORT`。网站的数据库入口会跟随配置，不依赖原作者电脑的 IP。

## 包含哪些容器

| 服务 | 职责 |
| --- | --- |
| `web` | Flask + Gunicorn、BGE 中文模型、文章和所有页面 |
| `init` | 数据库健康后执行一次导入；成功后网站才启动 |
| `neo4j` | Neo4j Community 5.26，保存图关系及同一组 Chunk 向量 |
| `milvus` | Milvus 2.6.4，保存 512 维文本向量与元数据 |
| `etcd` / `minio` | Milvus 所需的元数据和对象存储 |
| `attu` | Milvus 的可视化管理界面 |

各服务通过 Compose 内部网络访问。Milvus、etcd、MinIO 不发布宿主机端口。数据库使用命名数据卷，网站不挂载原工作区或原电脑上的虚拟环境。

## 数据与模型边界

- 当前演示语料有 23 个来源、30 个 Chunk。Neo4j 图事实由人工整理，再由初始化容器导入；向量由真实的 `BAAI/bge-small-zh-v1.5` 模型计算。
- LightRAG 1.5.7 的真实 NetworkX / NanoVectorDB 存储随包携带，含 5 段来源、9 个实体和 9 条关系；案例会实际查询实体和关系索引。它是独立的旧快照，不含最新人事变动。
- 没有接入 LLM 自动抽取或答案生成。PageIndex、全局归纳、Agent、Wiki、OKF 案例中的预编步骤仍保留原有教学标记；容器化不会改变这些能力边界。
- `article/article.html` 是打包时的文章快照。更新文章时替换此文件，再执行 `docker compose up -d --build web`。

## 验证与维护

```sh
docker compose ps --all                   # 健康状态；init 正常完成后显示 Exited (0)
docker compose logs --tail 100 init web   # 初始化与网站日志
docker compose exec -T web python /opt/demo/docker/verify.py
./stop.sh                                 # 停止容器，保留数据
docker compose up -d --wait               # 再次启动
```

验证脚本检查页面、文章内容、两库数量、真实向量检索、Neo4j 路径、九个案例及时间边界。

修改 `app/data/` 的语料后：

```sh
docker compose build web
docker compose run --rm init
docker compose up -d web
```

导入按固定 ID 更新，不清库；从 JSON 删除记录不会自动清除数据库旧记录。`docker compose down` 会删除容器和网络，但保留数据卷。不要加 `-v`，除非确实要丢弃这套演示数据。

## 局域网访问

网站默认监听 `0.0.0.0`，同局域网设备访问 `http://本机局域网IP:8018/`，文章在 `/article/`。修改 `WEB_PORT` 后使用对应端口。需要保持 Docker 和电脑运行，并允许系统防火墙放行该端口。

数据库管理界面默认只允许本机访问。如果需要其他设备打开 Attu / Neo4j，修改 `.env`：

```dotenv
ADMIN_BIND=0.0.0.0
PUBLIC_HOST=你的局域网IP
```

然后执行 `docker compose up -d`。远程 Neo4j 连接地址使用 `bolt://你的局域网IP:7687`（或修改后的 Bolt 端口）。`PUBLIC_HOST` 不能填写 `0.0.0.0`。这套无业务认证的演示网站与 Attu 用于本机或可信局域网，不作为公网服务。

## 完全离线搬到另一台电脑

常规部署包包含代码、语料、文章和模型，**不包含多个 GB 的 Docker 基础镜像**。可以在有网络的电脑上另外导出：

```sh
./export-images.sh
```

将本目录与生成的 `rag-demo-images.tar.gz` 一起复制到目标电脑，然后：

```sh
docker load -i rag-demo-images.tar.gz
cp .env.example .env
docker compose up -d --no-build --pull never --wait --wait-timeout 360
```

离线包仍由 `init` 从随包语料初始化全新数据库；不包含已有 Docker 数据卷中的个人修改。导出的镜像架构与构建机器一致。

## 目录

```text
compose.yaml            全部容器与启动顺序
Dockerfile              网站、Python 依赖与模型镜像
.env.example            示例配置；不包含原演示环境凭证
requirements.lock.txt   固定 Python 包版本
app/                    网站、语料、LightRAG 存储与 BGE 缓存
article/article.html    自包含技术文章
docker/                 自动初始化、健康检查、验证脚本
```

参考：[Compose 启动依赖与健康检查](https://docs.docker.com/compose/how-tos/startup-order/)、[Neo4j Docker](https://neo4j.com/docs/operations-manual/current/docker/introduction/)。
