# 第三方来源说明

## 中文 Embedding 模型

- 原始模型：[BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)。
- 本仓库携带的 ONNX 版本：[Qdrant/bge-small-zh-v1.5](https://huggingface.co/Qdrant/bge-small-zh-v1.5)，模型卡标注 MIT。
- 固定模型快照：`46fbe35fd4374a00fee7de77dfddaeb6dd6a2c59`。
- 文件位置：`app/.cache/models/models--Qdrant--bge-small-zh-v1.5/`。
- 上游 FlagEmbedding 的 MIT 许可证保留在 [licenses/FlagEmbedding-MIT.txt](licenses/FlagEmbedding-MIT.txt)，来源为 [FlagEmbedding/LICENSE](https://github.com/FlagOpen/FlagEmbedding/blob/master/LICENSE)。

模型来自上游，未在本项目中训练；本仓库不对模型权重主张原创权利。

## 软件依赖

Python 包由 `requirements.lock.txt` 固定版本并在构建镜像时安装，容器依赖由 `compose.yaml` 声明。FastEmbed、ONNX Runtime、LightRAG、Neo4j、Milvus、Attu、etcd、MinIO 等软件各自适用上游许可证。

`app/lightrag-demo/storage/` 是使用虚构语料生成的演示存储；本项目并非 LightRAG、Microsoft GraphRAG 或 PageIndex 的官方发行版。

## 文章与数据

演示文档、人物、任务和项目均为教学用途的虚构材料。分享文章中保留了论文、官方项目和参考文章链接；这些来源的内容与名称仍归各自权利人所有。
