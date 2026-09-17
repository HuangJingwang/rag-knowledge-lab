# LightRAG 真实存储演示

本目录实际安装并运行 **LightRAG 1.5.7**，使用官方 `ainsert_custom_kg` 接口导入 5 段虚构来源、9 个实体和 9 条关系。向量由本地 `BAAI/bge-small-zh-v1.5` 模型生成，维度为 512。实体、关系和原文向量都已落盘。

**原文和图关系由我们人工整理后导入，不是 LLM 自动抽取。**`llm_model_func` 被设置为一旦调用就抛出异常；成功运行的日志与 `export.json` 记录 LLM 调用次数为 **0**。本演示展示 LightRAG 的真实入库结果，没有运行答案生成、关键词提取或完整 hybrid 查询。

## 看哪些文件

| 文件 | 内容 |
| --- | --- |
| `custom_kg.json` | 交给官方接口的输入；描述、类型、关键词和来源均可直接查看 |
| `sources/chunk-*.md` | 从统一数据集选出的 5 份原文，编号对应 `demo:chunk:03/11/17/18/19` |
| `export.json` | 从 LightRAG 实际存储 API 导出的实体、关系、来源映射和向量前 8 维 |
| `storage/graph_chunk_entity_relation.graphml` | NetworkX 实际保存的知识图谱 |
| `storage/kv_store_text_chunks.json` | JsonKV 实际保存的原文块 |
| `storage/vdb_entities.json` | NanoVectorDB 实际保存的实体向量 |
| `storage/vdb_relationships.json` | NanoVectorDB 实际保存的关系向量 |
| `storage/vdb_chunks.json` | NanoVectorDB 实际保存的原文向量 |
| `import.log` | 真实导入运行日志 |

`export.json` 中的 `raw` 保留图存储实际属性；展示用的 `type` 对应实际 `entity_type`，`source_ids` 是实际 `source_id` 按框架分隔符拆出的数组。源块 ID 由 LightRAG 对内容计算哈希，`sources[].original_id` 保留统一语料中的 `demo:chunk:xx`，便于与 Milvus、Neo4j 对照。当前版本把 `file_path` 规范化成了 `chunk-17.md` 这样的文件名；实际文件保存在本目录 `sources/` 下。

## 读图时注意方向与类型

这个默认 NetworkX 实现保存的是**无向图**。LightRAG 的关系字段主要是 `description`、`keywords`、`weight`、`source_id`、`file_path`；本例没有把 Neo4j 的 `RESPONSIBLE_FOR`、`DEPENDS_ON` 伪装成 LightRAG 原生关系类型。

例如“李明负责支付回调改造”，两个实体被连接起来；“谁负责谁”的业务语义写在关系描述和关键词中。导出的 `source/target` 按框架使用的端点顺序排列，**不表示业务箭头方向**。因此可用它展示 LightRAG 的实体/关系索引，但不要把图上的无向连接直接讲成有向依赖传播或时序推理。

## 重跑

在本目录运行：

```sh
./.venv/bin/python import_custom_kg.py
```

独立环境安装了 `requirements.txt` 中锁定的 `lightrag-hku==1.5.7`、`fastembed==0.8.0`。模型权重复用上一级 `.cache/models`，导入脚本以 `local_files_only=True` 读取，不需要云端模型密钥。空白 `.env` 用于阻止第三方模块向父目录查找凭证文件。

脚本使用固定实体名称、端点对和文本块内容，重复导入会更新本例相同记录；只写本目录。导入脚本同时校验向量维度、9/9/5 数量和全部来源映射。

首次完成后，另外做了磁盘复核：重新读取 GraphML，实体与关系属性和导出的 `raw` 一致；重新加载两个 NanoVectorDB 文件，18 条向量的前 8 维均与导出一致。

`ainsert_custom_kg` 用于受控的小型演示。它直接写入整理好的知识对象，不具有完整文档抽取管线的全部恢复和生命周期保证；不要据此推断这已经是生产环境的文档更新方案。

## 官方实现链接

- [LightRAG v1.5.7：`ainsert_custom_kg`](https://github.com/HKUDS/LightRAG/blob/v1.5.7/lightrag/lightrag.py#L3484)
- [默认 NetworkX 图存储](https://github.com/HKUDS/LightRAG/blob/v1.5.7/lightrag/kg/networkx_impl.py)
- [默认 NanoVectorDB 向量存储](https://github.com/HKUDS/LightRAG/blob/v1.5.7/lightrag/kg/nano_vector_db_impl.py)
- [LightRAG 官方项目](https://github.com/HKUDS/LightRAG)
