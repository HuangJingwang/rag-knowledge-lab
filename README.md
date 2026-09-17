# RAG Knowledge Lab

最近在做会议模块的 Agent 开发，于是调研了大量方案。老板让我开一个内部技术分享会，但我觉得只讲某一个框架会太片面，于是整理了从传统 RAG 到 OKF 0.2 的整体技术脉络，作为这次分享的内容。

整理到这里，也希望把这些材料留给正在学习 RAG 和知识管理的读者：每种方案为什么出现、具体怎么工作、解决了哪些问题，又有什么代价。

仓库包含一篇完整技术文章和配套实验网站。文章帮助理解原理与方案之间的联系，网站让你对照原文、文本切块、向量召回和知识关系，检查一次检索到底找到了什么。网站、Milvus、Neo4j 及管理界面通过 Docker Compose 一起启动。

中文 Embedding 在本地运行，无需模型 API Key。语料全部虚构，可以直接修改并进行检索实验。

[学习内容](#可以学到什么) · [快速启动](#快速启动) · [动手实验](#动手实验) · [真实执行范围](#真实执行范围) · [部署与维护](docs/deployment.md)

## 可以学到什么

| 主题 | 要理解的问题 | 配套材料 |
| --- | --- | --- |
| 传统 RAG | 文档如何变成可检索的片段？为什么检索到相似内容，仍可能缺少回答所需的条件？ | 原文与 Chunk 标注、实际召回结果、Milvus 数据 |
| GraphRAG 与 LightRAG | 图关系如何补充向量检索？社区报告与实体、关系两路检索分别做了什么？ | 原理与成本对比、Neo4j 路径、LightRAG 索引 |
| 时序知识图谱 | 新决定出现后，如何保留历史，并按时间和适用范围判断有效结论？ | 有效区间查询、不同时间点的结果对照 |
| PageIndex | 如何利用文档目录定位原文？无向量检索依赖哪些信息？ | 完整文档、目录树、章节与适用条件的阅读对照 |
| Agentic RAG | 一次检索不够时，如何识别证据缺口并继续补查？ | 检索、追溯依据、读取原文的分步案例 |
| LLM Wiki 与 OKF | 如何把资料整理成可复用知识？知识的维护方式与交换规范有什么区别？ | 知识页修订前后对照、来源与时效元数据 |

这些内容涉及检索方法、查询流程、知识维护和文件规范等不同层面，可以相互配合。阅读时可以重点比较各自处理的问题和适用条件，不必把它们理解成逐代替换的关系。

## 快速启动

准备 Docker Engine 或 Docker Desktop，以及 Docker Compose v2。建议给 Docker 分配至少 **8 GB 内存、10 GB 可用磁盘**。已验证 Linux amd64 容器；Apple Silicon 默认使用模拟运行，原生 ARM 尚未验证。

```bash
git clone https://github.com/HuangJingwang/rag-knowledge-lab.git
cd rag-knowledge-lab
./start.sh
```

启动脚本会生成 `.env`、构建镜像、等待数据库就绪、导入演示数据，然后启动网站。**首次构建需要联网**下载依赖和容器镜像；中文模型已经随仓库携带，运行时无需下载模型。

| 页面 | 默认地址 |
| --- | --- |
| 文档工作区 | [localhost:8018](http://localhost:8018/) |
| 完整文章 | [localhost:8018/article/](http://localhost:8018/article/) |
| 九组案例 | [localhost:8018/examples](http://localhost:8018/examples) |
| LightRAG 数据 | [localhost:8018/entities](http://localhost:8018/entities) |
| Attu | [localhost:8000](http://localhost:8000/) |
| Neo4j Browser | [localhost:7474/browser/](http://localhost:7474/browser/) |

Attu 连接 `milvus:19530`。Neo4j 使用 `bolt://localhost:7687`，用户名 `neo4j`，密码见 `.env` 的 `NEO4J_PASSWORD`。

如果默认端口已被占用，先复制 `.env.example` 为 `.env`，修改对应端口，再运行启动脚本。Windows 的 Compose 命令、局域网访问、离线搬迁与数据更新见[部署说明](docs/deployment.md)。

## 动手实验

启动后可以先在 `/article/` 阅读原理，也可以带着下面的问题操作网站，再回到文章查对应章节。

1. **召回的片段够不够回答问题？** 显示原文中的 Chunk 标注，输入“谁负责支付回调改造？”，核对命中结果的来源和时间。再打开传统 RAG 案例，检查重试规则与适用条件是否都被检索到。
2. **关系能补充哪些证据？** 打开“GraphRAG · 关联查询”案例，沿人物、任务和项目查看影响路径；在 Attu 和 Neo4j Browser 中找到同一份资料，对照向量记录与图结构。可使用[示例 Cypher](app/graph/demo_queries.cypher)。
3. **检索入口变化后，找到的内容有什么不同？** 运行 LightRAG 案例，对比实体和关系两路召回；在 PageIndex 案例中比较“只读规则”和“连同适用条件一起读”的差别。
4. **资料变化后，原来的结论还成立吗？** 切换时序案例的观察时间与适用范围，再查看 Wiki 修订前后的内容，理解查询时过滤和知识页维护分别承担的工作。

## 真实执行范围

**向量和数据库查询是真实执行的；当前没有接入 LLM 自动抽取或答案生成。** 页面上的教学步骤会标明实现边界。

| 功能 | 当前实现 |
| --- | --- |
| 中文 Embedding | 本地 `BAAI/bge-small-zh-v1.5`，FastEmbed / ONNX Runtime，512 维向量 |
| 传统 RAG 检索 | 真实 Milvus 向量搜索；展示召回证据，没有生成模型和重排模型 |
| 图增强检索 | 真实 Neo4j 向量查询、关系扩展与路径查询；关系由人工整理后导入 |
| 微软 GraphRAG 全局归纳 | 人工编写的社区报告与归纳示例，未执行官方社区发现或 Global Search |
| LightRAG | 真实 LightRAG 1.5.7 实体、关系索引查询；关键词手工指定，未执行完整 hybrid 问答管线 |
| 时序知识图谱 | Neo4j 实际按有效区间和适用范围过滤；未运行 Graphiti 自动抽取 |
| PageIndex | 实际从完整 Markdown 提取目录和行号；摘要与阅读路径为教学设计，未调用官方 PageIndex 推理导航 |
| Agentic RAG | 真实检索与追溯，工具顺序预设，未接入自主规划 Agent |
| LLM Wiki / OKF | 人工维护的知识页与简化元数据示例，未自动修订，也不宣称通过 OKF 官方规范校验 |

因此，这个项目适合解释数据如何组织、检索结果如何回溯，不能用它测量各框架的端到端准确率、LLM 调用成本或生产性能。

## 数据与架构

演示围绕虚构的支付升级、项目交付和接入决策展开，包含跨文档依赖、负责人变动、规则适用条件和结论随时间变化等情况。

| 数据 | 数量 |
| --- | --- |
| 来源资料 | 23 份 |
| 文本 Chunk | 30 个 |
| Neo4j 节点 / 关系 | 66 个 / 126 条 |
| LightRAG 独立快照 | 5 段来源、9 个实体、9 条关系 |

LightRAG 存储是独立的旧快照，不含最新人员调整，不能直接拿它回答最新负责人问题。所有数字对应当前仓库内的演示数据。

```mermaid
flowchart LR
    Docs[虚构文档与人工关系] --> Init[初始化容器]
    Model[本地中文 Embedding] --> Init
    Init --> Milvus[(Milvus)]
    Init --> Neo4j[(Neo4j)]
    User[浏览器] --> Web[Flask 网站]
    Web --> Model
    Web --> Milvus
    Web --> Neo4j
    Web --> Light[LightRAG 本地索引]
    Web --> Article[文章与教学案例]
    Attu[Attu] --> Milvus
    Browser[Neo4j Browser] --> Neo4j
```

网站由 Gunicorn 运行。Compose 根据健康检查安排启动顺序，数据库数据写入命名卷。Milvus 的 etcd、MinIO 依赖也随 Compose 启动。

## 验证与日常操作

```bash
# 查看健康状态；init 正常结束后显示 Exited (0)
docker compose ps --all

# 检查页面、真实检索、图路径、九组案例和时间边界
docker compose exec -T web python /opt/demo/docker/verify.py

# 查看初始化和网站日志
docker compose logs --tail 100 init web

# 停止，保留数据
./stop.sh

# 再次启动
docker compose up -d --wait
```

已验证从空数据库初始化、真实检索、九组案例，以及停止后重新启动的数据保留。详见[验证记录](VERIFIED.md)。模型也已在禁用容器网络的环境中完成索引查询验证。

## 目录

```text
app/
  app.py                  网站入口与检索接口
  data/                   虚构语料、图关系及教学文档
  graph/                  Neo4j 导入脚本与 Cypher 示例
  lightrag-demo/           LightRAG 存储、来源与查询脚本
  templates/、static/     页面与样式
  .cache/models/          随仓库携带的中文模型
article/article.html      完整文章，插图内嵌
compose.yaml              网站、数据库及依赖编排
Dockerfile                网站与模型镜像
docker/                   初始化、健康检查和验证脚本
docs/deployment.md        配置、局域网、维护和离线部署
```

## 网络访问与使用范围

网站默认允许同局域网访问；Attu 和 Neo4j 管理端口默认仅本机可用，开放方式见[部署说明](docs/deployment.md#局域网访问)。这套演示没有业务登录和权限隔离，仅适合在本机或可信局域网内使用。

`.env`、本机日志、虚拟环境和 Docker 数据卷不进入版本库。模型约 91 MiB，完整文章约 31 MiB，因此初次克隆会比纯代码项目慢。仓库不包含 Docker 基础镜像；完全离线迁移需要先运行 `export-images.sh` 导出镜像。

## 相关项目

[Milvus](https://github.com/milvus-io/milvus) · [Neo4j](https://github.com/neo4j/neo4j) · [Microsoft GraphRAG](https://github.com/microsoft/graphrag) · [LightRAG](https://github.com/HKUDS/LightRAG) · [Graphiti](https://github.com/getzep/graphiti) · [PageIndex](https://github.com/VectifyAI/PageIndex)

本项目独立用于教学演示，与以上项目无官方隶属关系。模型和依赖的来源见[第三方说明](THIRD_PARTY_NOTICES.md)，文章中的技术论述保留了对应参考链接。
