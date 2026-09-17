"""Article case walkthroughs: real storage queries and explicitly labeled teaching artifacts."""
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from threading import Lock
from urllib.parse import quote
from flask import Blueprint, jsonify, render_template, request
from page_document import extract_document
from demo_common import BASE, COLLECTION, embedder, milvus, graph, database

examples = Blueprint('examples', __name__)
run_lock = Lock()
CATALOG = [
 dict(id='rag',name='传统 RAG',theme='规则与条件',question='支付回调失败后能直接重试吗？',feature='先找相关片段，再核对它是否包含完整条件。',mode='真实 Milvus 向量检索',boundary='没有调用生成模型。Top-K 排名照实返回，不预设一定漏召回。',sources=[27,28],takeaway='“允许重试”和“仅适用于已启用幂等校验”必须一起读取。切块与召回都可能影响条件是否完整。',link='https://milvus.io/docs/build-rag-with-milvus.md'),
 dict(id='graph',name='GraphRAG · 关联查询',theme='人、任务、项目',question='李明调走后，哪个项目的上线依赖需要重新安排？',feature='把分散在任务、上线计划和会议中的证据连起来。',mode='真实 Neo4j 路径查询',boundary='演示图增强检索机制；未运行微软 GraphRAG 的自动抽取或 Local Search 管线。',sources=[24,25,26],takeaway='路径连出商城支付升级项目；最新会议再补上“尚未交接”。不能从旧负责关系推断新负责人。',link='https://microsoft.github.io/graphrag/query/local_search/'),
 dict(id='global',name='GraphRAG · 全局归纳',theme='季度共性问题',question='这个季度，各项目反复出现的交付阻塞有哪些？',feature='从多个社区的材料归纳共性，不把一个项目的局部证据当成全貌。',mode='人工社区报告示例',boundary='项目分组、社区报告和归纳均为预先编写；未运行社区发现、LLM 报告生成或 Global Search。',sources=[12,13,29,30],takeaway='联调依赖只出现在支付项目；需求变更与验收条件缺失在另外两个项目重复出现。这里统计的是三个演示项目，不能外推到真实季度。',link='https://microsoft.github.io/graphrag/query/global_search/'),
 dict(id='light',name='LightRAG',theme='实体与关系两路入口',question='支付结果查询接口延期，会影响谁的工作？',feature='实体索引找具体对象，关系索引找依赖主题，再回到原文。',mode='真实 LightRAG 索引查询',boundary='调用已安装 LightRAG 的 entities_vdb / relationships_vdb；关键词手工指定，未执行完整 hybrid 查询或答案生成。索引是 9 月 16 日快照，不能回答 9 月 17 日的人事变化。',sources=[3,11,17,18,19],takeaway='两路入口的召回对象不同，但来源都能落回原文。默认图存储是无向图，业务方向要读关系描述。',link='https://github.com/HKUDS/LightRAG'),
 dict(id='temporal',name='时序知识图谱',theme='决定何时对谁有效',question='在这个时间点，标准客户和试点客户分别怎么接入？',feature='同一个问题，时间和客户范围不同，有效结论也不同。',mode='真实 Neo4j 时间过滤',boundary='实际查询有效区间；时间和关系为人工整理，未运行 Graphiti 自动抽取。区间左闭右开。',sources=[8,9,14,15,16],takeaway='第 1 小时直连，第 3 小时确认网关；下周只对试点客户临时覆盖。窗口结束后没有新决定时，应显示“待确认”。',link='https://github.com/getzep/graphiti'),
 dict(id='page',name='PageIndex',theme='沿目录找规则',question='回调重试有哪些适用条件？',feature='先看章节树，再读取规则所在章节及相邻的适用条件。',mode='完整文档目录提取＋导航演示',boundary='目录在每次运行时从完整 Markdown 的标题层级实际提取；节点摘要为人工编写的教学内容，概括各节及其子节。文档为围绕原文章案例补全的虚构规范。未调用官方 PageIndex 或 LLM 推理导航，位置使用真实行号。',sources=[27,28],takeaway='章节位置能帮助补回“上述规则”的指代。无向量导航也依赖目录、摘要与路径选择质量。',link='https://github.com/VectifyAI/PageIndex'),
 dict(id='agent',name='Agentic RAG',theme='发现缺口再补查',question='关闭本地缓存后，不扩容的方案还成立吗？',feature='查到结论后继续追依据，再核对前提是否改变。',mode='真实查询＋固定教学流程',boundary='向量检索、Neo4j 追溯和原文读取是真实执行；工具顺序由代码预设，并非 LLM 自主规划的 Agent。',sources=[21,22,23],takeaway='已知压测仅验证开启缓存。关闭缓存后需要重新评估容量；证据不足以回答必须扩容多少台。',link='https://docs.langchain.com/oss/python/langchain/rag'),
 dict(id='wiki',name='LLM Wiki',theme='来源变了，知识页也要更新',question='李明调离后，项目知识页该怎样修订？',feature='展示旧知识页、新会议证据和修订后的知识页，保留来源与变更记录。',mode='人工维护的 Wiki 示例',boundary='前后版本均为人工编写，用于解释维护过程；未调用 LLM 自动修订。',sources=[24,25,26],takeaway='删除“当前负责人已确定”的误导，记录接手人待确认；旧版本和来源仍可追溯。Wiki 是可复用知识，不应代替任务系统的实时状态。',link='/article/#8-llm-wiki'),
 dict(id='okf',name='OKF',theme='知识文件携带来源和时效',question='收到一份接口知识文件，怎么知道出处和是否该复核？',feature='打开 Markdown 文件，检查来源、状态与复核日期，再定位正文。',mode='知识文件教学示例',boundary='文件是供讲解的简化 frontmatter 示例；仅检查本演示字段，不宣称通过 OKF 0.2 官方 schema 验证。格式本身不执行检索或计算核验。',sources=[3,27,28],takeaway='来源存在、状态可用和复核时间是不同判断。标记“需要复核”不等于知识已经错误。',link='https://github.com/GoogleCloudPlatform/open-knowledge-format'),
]
BY_ID={x['id']:x for x in CATALOG}
def docs(): return {r['id']:r for r in json.loads((BASE/'data/documents.json').read_text())}
def ids(numbers): return [f'demo:chunk:{n:02d}' for n in numbers]
def evidence(numbers):
 all_docs=docs(); return [all_docs[x] for x in ids(numbers)]
def item(title,text,nums=(),**extra): return dict(title=title,text=text,source_ids=ids(nums),**extra)
def step(title,note,items=(),**extra): return dict(title=title,note=note,items=list(items),**extra)
def vector_search(query,k):
 v=embedder().embed_query(query)
 hits=milvus().search(collection_name=COLLECTION,data=[v],limit=k,output_fields=['id','title','text','source_id'],search_params={'metric_type':'COSINE','params':{}})[0]
 return [dict(title=h['entity']['title'],text=h['entity']['text'],source_ids=[h['entity']['id']],score=round(h['distance'],4)) for h in hits]
def sourced_graph(numbers):
 with graph().session(database=database()) as session:
  return session.run('''MATCH (a:RagDemo)-[r]->(b:RagDemo)
   WHERE NOT a:Chunk AND NOT b:Chunk AND any(s IN r.source_ids WHERE s IN $ids)
   RETURN a.name AS from, type(r) AS type, b.name AS to, r.source_ids AS source_ids ORDER BY r.id''',ids=ids(numbers)).data()

def run_case(key,variant):
 case=BY_ID[key]; source_steps=[item(d['title'],d['text'],[int(d['id'].split(':')[-1])]) for d in evidence(case['sources'])]
 if key=='rag':
  k={'1':1,'3':3,'5':5}.get(str(variant),1); hits=vector_search(case['question'],k); found={x for h in hits for x in h['source_ids']}; missing=set(ids([27,28]))-found
  return [step('实际召回',f'Top-K = {k}；使用同一个本地中文 Embedding 模型。',hits),step('核对条件是否齐全','这一步按事先标注的必要证据检查召回覆盖，不是模型评分。',[item('规则＋适用条件','两段必要证据均已召回。' if not missing else '本次缺少：'+ '、'.join(sorted(missing)),[27,28])]),step('回看完整章节','补看相邻分块，观察结论的适用范围。',source_steps)]
 if key=='graph':
  rels=sourced_graph([24,25,26])
  with graph().session(database=database()) as s:
   paths=s.run('''MATCH p=(m:RagDemo {id:'demo:article:staff-meeting'})-[:ABOUT]->(t:RagDemo)<-[:DEPENDS_ON]-(plan:RagDemo {id:'demo:article:payment-launch'})-[:BELONGS_TO]->(project:RagDemo)
   RETURN [n IN nodes(p) | n.name] AS path''').data()
  return [step('三个来源分别说明什么','任务记录、上线计划和最新会议缺一不可。',source_steps),step('沿实际路径连起来','Neo4j 查询从最新会议追到任务、上线计划和项目。',[item('查询返回的路径',' → '.join(p['path']),[24,25,26]) for p in paths],relations=rels),step('保留没有答案的部分','这是人工讲解结论，不是生成模型回答。',[item('需要重新安排','商城支付升级项目需要确认支付回调改造的接手人及排期。会议未给出新负责人，不能补出一个名字。',[25,26])])]
 if key=='global':
  reports=[item('支付项目社区','主要阻塞是上游查询接口延期，影响回调联调与验收排期。',[12,13]),item('仓储项目社区','需求反复变更，验收条件未同步，导致返工。',[29]),item('客户管理项目社区','需求边界反复变化，交付时缺少验收确认。',[30])]
  return [step('先看到各项目原始材料','仓储和客户管理资料是为文章的整体归纳问题补充的虚构样本。',source_steps),step('按社区组织报告','此处按项目人工分组。正式微软 GraphRAG 的社区可以通过图聚类产生，未必等同于项目。',reports),step('对照各组，再归纳共性','人工 map/reduce 讲解；覆盖三个示例项目，不是相关性排名。',[item('跨项目共性','需求变更、验收条件缺失：两个演示项目中重复出现。',[29,30]),item('局部问题','查询接口延期导致的联调依赖：支付项目的具体问题，不应当成所有项目的共同原因。',[12,13])])]
 if key=='light':
  proc=subprocess.run([os.environ['LIGHTRAG_PYTHON'],str(BASE/'lightrag-demo/query_stores.py')],capture_output=True,text=True,timeout=90,cwd=BASE/'lightrag-demo')
  lines=[l for l in proc.stdout.splitlines() if l.startswith('RESULT_JSON:')]
  if proc.returncode or not lines: raise RuntimeError('LightRAG storage query failed')
  data=json.loads(lines[-1].split(':',1)[1]); selected=sorted({i for group in ['entities','relations'] for h in data[group] for i in h['source_ids']}); all_docs=docs()
  return [step('实体路：找具体对象','手工低层关键词：'+data['low_keyword']+'；以下为 entities_vdb 的实际相似度结果。',data['entities']),step('关系路：找依赖主题','手工高层关键词：'+data['high_keyword']+'；以下为 relationships_vdb 的实际相似度结果。',data['relations']),step('合并来源，回到文本','按实际存储中的 source_id 合并去重；两路分数不直接相加。',[dict(title=all_docs[i]['title'],text=all_docs[i]['text'],source_ids=[i]) for i in selected])]
 if key=='temporal':
  at={'first':'2026-09-07T11:00:00+08:00','third':'2026-09-07T13:00:00+08:00','next':'2026-09-14T12:00:00+08:00','expired':'2026-09-21T12:00:00+08:00'}.get(variant,'2026-09-14T12:00:00+08:00'); results=[]
  with graph().session(database=database()) as s:
   for scope in ['标准接入客户','试点接入客户']:
    rows=s.run('''MATCH (d:RagDemo:Decision)-[r:APPLIES_TO]->(s:RagDemo:CustomerScope {name:$scope}) WHERE datetime(r.valid_from)<=datetime($at) AND (r.valid_to='' OR datetime($at)<datetime(r.valid_to)) RETURN d.decision AS decision,r.valid_from AS start,r.valid_to AS end,r.source_ids AS source_ids''',scope=scope,at=at).data()
    results.append(dict(title=scope,text='；'.join(r['decision']+'（'+r['start']+' 至 '+(r['end'] or '未设结束')+'）' for r in rows) if rows else '没有覆盖该时间点的有效决定，需另行确认。',source_ids=sorted({i for r in rows for i in r['source_ids']})))
  return [step('指定观察时间',at,[item('查询规则','valid_from ≤ 时间点 < valid_to；未设结束时间的记录持续有效。')]),step('分别查询两个适用范围','来自 Neo4j 的实际有效区间查询。',results),step('保留变化的证据','历史决定没有删除，只是适用区间不同。',source_steps)]
 if key=='page':
  selected=[27] if variant=='rule' else [27,28]
  document=extract_document()
  return [step('从完整文档提取目录',f"{document['filename']} · {document['line_count']} 行 · {document['heading_count']} 个标题。每个标题下直接显示教学摘要；点击节点可对照行号和原文。",document=document),step('选择读取路径','对照完整目录确定范围；本次路径由观察条件明确指定。',[item('本次路径','支付接口接入与回调处理规范 → 4 回调处理 → '+('4.1 重试规则' if variant=='rule' else '4.1 重试规则＋4.2 适用条件'),selected)]),step('读取章节原文','以下两段与完整文档中的 4.1、4.2 节一致。仅阅读规则会遗漏它的适用前提。',[item(d['title'],d['text'],[int(d['id'].split(':')[-1])]) for d in evidence(selected)])]
 if key=='agent':
  hits=vector_search('大促上线方案不扩容',3); rels=sourced_graph([21,22,23])
  return [step('工具一：检索上线方案','真实 Milvus 搜索；工具顺序预先规定。',hits),step('工具二：追查引用依据','真实 Neo4j 关系查询，查看容量结论引用哪个报告。',[item('发现的证据缺口','压测是在什么条件下通过的？关闭缓存是否仍满足这个条件？')],relations=rels),step('工具三：读取报告和最新会议','实际读取原文；没有调用外部任务系统。',[item(d['title'],d['text'],[int(d['id'].split(':')[-1])]) for d in evidence([21,23])]),step('停止补查的教学判断','人工给出的停止条件：已经识别出前提变化，资料没有新的容量测试结果。',[item('证据支持到这里','需要重新评估容量。尚不能确定仍无需扩容，也不能直接算出要增加多少台服务器。',[21,22,23])])]
 if key=='wiki':
  before=(BASE/'data/example_artifacts/wiki-before.md').read_text(); after=(BASE/'data/example_artifacts/wiki-after.md').read_text()
  return [step('修订前：已有知识页','人工编写的旧版本，保留当时的来源。',code=before),step('新来源：人员调整会议','新会议改变的是当前交接状态，旧记录仍可作为历史证据。',[source_steps[2]]),step('修订后：保留不确定性与修订记录','人工编写的更新版本；自动写作、冲突检测尚未接入。',code=after)]
 if key=='okf':
  text=(BASE/'data/example_artifacts/payment-interface.md').read_text(); header=text.split('---',2)[1]; fields=dict(line.split(': ',1) for line in header.splitlines() if ': ' in line and not line.startswith(' ')); metadata={'status':fields['status'],'stale_after':fields['stale_after'],'source_ids':[line.strip()[2:] for line in header.splitlines() if line.strip().startswith('- ')]}; now=datetime.fromisoformat('2026-09-17T12:00:00+08:00'); stale=now>=datetime.fromisoformat(metadata['stale_after']); all_docs=docs(); refs_ok=all(i in all_docs for i in metadata['source_ids'])
  return [step('交付物：一个 Markdown 知识文件','简化 frontmatter 教学示例，可复制查看。',code=text),step('分开检查来源、状态与新鲜度','固定演示观察时间：2026-09-17 12:00 +08:00；不是全套官方规范校验。',[item('来源引用','全部来源 ID 可回溯到当前语料。' if refs_ok else '存在未找到的来源。',[3,27,28]),item('内容状态',metadata['status']+'：与是否到复核时间分开判断。'),item('复核时间','已到复核日期，需要重新核实。' if stale else '尚未到约定复核日期。')]),step('回到被引用的原文','格式保留来源线索；取证由应用完成。',source_steps)]

@examples.get('/examples')
def examples_page(): return render_template('examples.html')
@examples.get('/api/examples')
def examples_catalog(): return jsonify(cases=CATALOG)
@examples.post('/api/examples/<key>/run')
def examples_run(key):
 if key not in BY_ID: return jsonify(error='没有这个演示案例。'),404
 payload=request.get_json(silent=True) or {}
 if not isinstance(payload,dict) or not isinstance(payload.get('variant',''),str): return jsonify(error='参数格式不正确。'),400
 started=time.perf_counter()
 with run_lock: steps=run_case(key,payload.get('variant',''))
 return jsonify(case=BY_ID[key],steps=steps,evidence=evidence(BY_ID[key]['sources']),elapsed_ms=round((time.perf_counter()-started)*1000))

@examples.get('/api/examples/page/document')
def page_full_document(): return jsonify(extract_document())
