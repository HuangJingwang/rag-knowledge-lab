// 商城支付升级：虚构演示数据。每次选中一个完整查询运行。
// 所有时间都属于固定演示快照，不代表实际公司的实时状态。
// 关系的有效区间为 [valid_from, valid_to)，valid_to = '' 表示开放。

// 1. 看业务关系全图：隐藏 20 个原文 Chunk，先看到项目、人员、任务和决定。
// 在 Neo4j Browser 的 Graph 视图打开；点击节点看属性，点击边看 source_ids。
MATCH p = (a:RagDemo)-[r]->(b:RagDemo)
WHERE NOT a:Chunk AND NOT b:Chunk
RETURN p;

// 2. 只看项目、任务、人员：一屏讲清“谁负责哪个任务，任务属于哪个项目”。
MATCH p = (person:RagDemo:Person)-[:RESPONSIBLE_FOR]->(task:RagDemo:Task)-[:BELONGS_TO]->(project:RagDemo:Project)
RETURN p;

// 3. 多跳影响：查询接口延期，会影响哪些任务、哪些负责人和项目目标？
// 这里展示依赖关系；任务延期的历史证据见查询 7。
MATCH impact = (affected:RagDemo:Task)-[:DEPENDS_ON*1..3]->(base:RagDemo:Task {id: 'demo:task:query-api'})
OPTIONAL MATCH owner = (:RagDemo:Person)-[:RESPONSIBLE_FOR]->(affected)
OPTIONAL MATCH goal = (affected)-[:SUPPORTS|VERIFIES]->(:RagDemo:Goal)
RETURN impact, owner, goal;

// 4. 跨文档来源：哪份文档的结论基于另一份文档或会议决定？
MATCH basis = (doc:RagDemo:Document)-[:BASED_ON]->(source:RagDemo)
OPTIONAL MATCH evidence = (source)-[:CONFIRMED_IN]->(:RagDemo:Meeting)
RETURN basis, evidence;

// 5. 同一问题在不同时间的答案。Table 视图展示 6 行：
// 9 月 7 日 10:40：标准/试点都直连。
// 9 月 7 日 12:30：标准/试点都走网关。
// 9 月 16 日 10:00：标准仍走网关，试点在窗口内直连。
UNWIND ['2026-09-07T10:40:00+08:00', '2026-09-07T12:30:00+08:00', '2026-09-16T10:00:00+08:00'] AS at
MATCH (decision:RagDemo:Decision)-[validity:APPLIES_TO]->(scope:RagDemo:CustomerScope)
WHERE datetime(validity.valid_from) <= datetime(at)
  AND (validity.valid_to = '' OR datetime(at) < datetime(validity.valid_to))
RETURN at AS `查询时点`, scope.name AS `客户范围`, decision.decision AS `当时有效方案`,
       validity.valid_from AS `生效时间`, validity.valid_to AS `失效时间`, validity.source_ids AS `来源片段`
ORDER BY `查询时点`, `客户范围`;

// 6. 看推翻与局部覆盖：后来的决定并不总是让整条旧决定失效。
MATCH history = (newer:RagDemo:Decision)-[:SUPERSEDES|PARTIALLY_OVERRIDES]->(older:RagDemo:Decision)
OPTIONAL MATCH scopes = (newer)-[:APPLIES_TO]->(:RagDemo:CustomerScope)
OPTIONAL MATCH source = (newer)-[:CONFIRMED_IN]->(:RagDemo:Meeting)
RETURN history, scopes, source;

// 7. 回溯原文：直接打开延期证据、最新交付状态、局部方案变更。
MATCH (chunk:RagDemo:Chunk)
WHERE chunk.id IN ['demo:chunk:12', 'demo:chunk:17', 'demo:chunk:14']
RETURN chunk.id AS `片段`, chunk.title AS `标题`, chunk.text AS `原文`,
       chunk.created_at AS `来源时间`, chunk.status AS `状态`
ORDER BY `来源时间`;

// 8. 查看具体关系的原始来源。可把关系 ID 换成点击边看到的 id。
MATCH (:RagDemo)-[relationship {id: 'demo:edge:033'}]->(:RagDemo)
UNWIND relationship.source_ids AS source_id
MATCH (source:RagDemo:Chunk {id: source_id})
RETURN type(relationship) AS `关系`, relationship.scope AS `适用范围`,
       source.title AS `来源标题`, source.text AS `来源原文`;

// 9. 当前任务快照。请展示 as_of，避免把固定演示数据讲成实时系统状态。
MATCH (person:RagDemo:Person)-[:RESPONSIBLE_FOR]->(task:RagDemo:Task)
MATCH (chunk:RagDemo:Chunk)-[:EXCERPT_OF]->(task)
WHERE chunk.status = '当前快照'
RETURN task.name AS `任务`, person.name AS `负责人`, task.status AS `当前状态`,
       task.as_of AS `快照截止时间`, chunk.text AS `最新记录`
ORDER BY `任务`;

// 10. 试点窗口结束以后：试点行会返回 null，表示缺少当时有效的确认决定。
// 不能把“临时直连已过期”自动推断为“恢复网关”。
MATCH (scope:RagDemo:CustomerScope)
OPTIONAL MATCH (decision:RagDemo:Decision)-[validity:APPLIES_TO]->(scope)
WHERE datetime(validity.valid_from) <= datetime('2026-09-22T10:00:00+08:00')
  AND (validity.valid_to = '' OR datetime('2026-09-22T10:00:00+08:00') < datetime(validity.valid_to))
RETURN scope.name AS `客户范围`, decision.decision AS `已确认的有效方案`;

// 11. 看全部原文片段与来源节点，便于与 Milvus / Attu 里的同 ID 文本对照。
MATCH p = (chunk:RagDemo:Chunk)-[:EXCERPT_OF]->(source:RagDemo)
RETURN p;
