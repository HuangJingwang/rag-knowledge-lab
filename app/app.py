"""Local, read-only retrieval demo. No LLM, remote API, or business system is called."""
import json
import logging
import os
import time
from datetime import datetime
from functools import lru_cache
from threading import Lock
from urllib.parse import urlsplit

from flask import Flask, jsonify, render_template, render_template_string, request, send_file
from neo4j_graphrag.retrievers import VectorCypherRetriever
from neo4j_graphrag.types import RetrieverResultItem
from demo_common import BASE, MODEL, DIMENSIONS, COLLECTION, INDEX, embedder, milvus, graph, database

app = Flask(__name__)
app.json.ensure_ascii = False
from examples import examples
app.register_blueprint(examples)
search_lock = Lock()


@app.context_processor
def access_context():
    host = urlsplit(request.host_url).hostname or 'localhost'
    host = '[' + host + ']' if ':' in host else host
    return {
        'local_database_tools': os.environ.get('ADMIN_BIND') == '0.0.0.0' or host in ('localhost', '127.0.0.1', '[::1]'),
        'attu_url': 'http://' + host + ':' + os.environ.get('ATTU_PORT', '8000') + '/#/databases/default/rag_demo_chunks/data',
        'neo4j_browser_url': 'http://' + host + ':' + os.environ.get('NEO4J_HTTP_PORT', '7474') + '/browser/',
    }


@app.get('/article')
@app.get('/article/')
@app.get('/article.html')
def knowledge_article():
    # Serve only this self-contained HTML, never the surrounding workspace.
    return send_file(os.environ['RAG_ARTICLE_PATH'], conditional=True)

# The official retriever first performs vector search, then runs this bounded
# business-relationship traversal for each candidate. No arbitrary Cypher input.
EXPAND = '''
OPTIONAL MATCH (node)-[:MENTIONS]->(entity:RagDemo)
WITH node, score, collect(DISTINCT entity) AS entities
CALL (entities) {
    UNWIND entities AS entity
    OPTIONAL MATCH path = (entity)-[:RESPONSIBLE_FOR|BELONGS_TO|DEPENDS_ON|DELIVERS|SUPPORTS|VERIFIES|BASED_ON|SPECIFIED_BY|CONFIRMED_IN|USES|ABOUT|SUPERSEDES|PARTIALLY_OVERRIDES|INVALIDATES|LEAVES*1..2]-(other:RagDemo)
    WITH collect(path) AS paths
    UNWIND paths AS path
    UNWIND relationships(path) AS rel
    WITH DISTINCT rel ORDER BY CASE type(rel) WHEN 'DEPENDS_ON' THEN 0 WHEN 'BASED_ON' THEN 1 WHEN 'RESPONSIBLE_FOR' THEN 2 ELSE 3 END, rel.id
    RETURN collect({from: startNode(rel).name, type: type(rel), to: endNode(rel).name, source_ids: rel.source_ids})[..18] AS relations
}
RETURN node.title AS title, node.text AS text, node.source_id AS source_id,
       node.id AS id, node.status AS status, score,
       [entity IN entities | entity.name] AS entities, relations
ORDER BY score DESC
'''


@lru_cache
def retriever():
    return VectorCypherRetriever(driver=graph(), index_name=INDEX, embedder=embedder(), retrieval_query=EXPAND, neo4j_database=database(), result_formatter=lambda record: RetrieverResultItem(content=json.dumps(record.data(), ensure_ascii=False)))


@app.get('/')
def index():
    return render_template('reader.html')


@app.get('/explore')
def explore():
    return render_template('index.html')


@app.get('/api/documents')
def documents_data():
    # Indexed passages stay byte-for-byte identical to ingestion. Reader prose
    # adds explicitly labeled editorial context without changing retrieval data.
    documents = json.loads((BASE / 'data' / 'documents.json').read_text())
    sources = {row['source_id'] for row in documents}
    knowledge_graph = json.loads((BASE / 'data' / 'graph.json').read_text())
    source_titles = {node['id']: node['name'] for node in knowledge_graph['nodes'] if node['id'] in sources}
    articles = json.loads((BASE / 'data' / 'reader_articles.json').read_text())
    return jsonify(documents=documents, source_titles=source_titles, articles=articles, source_count=len(sources), chunk_count=len(documents))


@app.get('/api/source-graph')
def source_graph():
    source_id = request.args.get('source_id', '')
    documents = json.loads((BASE / 'data' / 'documents.json').read_text())
    rows = [row for row in documents if row['source_id'] == source_id]
    if not rows:
        return jsonify(error='没有找到对应的示例原文。'), 404
    chunk_ids = [row['id'] for row in rows]
    with graph().session(database=database()) as session:
        relations = session.run('''
            MATCH (a:RagDemo)-[r]->(b:RagDemo)
            WHERE NOT a:Chunk AND NOT b:Chunk
              AND any(source IN coalesce(r.source_ids, []) WHERE source IN $chunk_ids)
            RETURN a.name AS from, type(r) AS type, b.name AS to, r.source_ids AS source_ids
            ORDER BY r.id
        ''', chunk_ids=chunk_ids).data()
    expanded = []
    for row in rows:
        supported = [relation for relation in relations if row['id'] in relation['source_ids']]
        entities = sorted({name for relation in supported for name in (relation['from'], relation['to'])})
        expanded.append(dict(row, entities=entities, relations=supported))
    return jsonify(source_id=source_id, graph=expanded, relation_count=len(relations))


@app.get('/entities')
def entities_page():
    return render_template('entities.html')


@app.get('/api/entities')
def entities_data():
    export = BASE / 'lightrag-demo' / 'export.json'
    if not export.exists():
        return jsonify(error='LightRAG 数据尚未准备好。'), 503
    return jsonify(json.loads(export.read_text()))


@app.get('/sources/<path:source_id>')
def source_page(source_id):
    # Source IDs link to the same prepared documents used by both databases.
    documents = json.loads((BASE / 'data' / 'documents.json').read_text())
    rows = [row for row in documents if row['id'] == source_id or row['source_id'] == source_id]
    if not rows:
        return jsonify(error='没有找到对应的示例原文。'), 404
    return render_template_string('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>演示原文 · RAG 数据实验室</title><style>body{max-width:850px;margin:50px auto;padding:0 24px;font:18px/1.8 system-ui;color:#23364c}a,h1,h2{color:#2259a2}article{border-top:1px solid #d7e2f1;padding:22px 0}small{color:#5c6f84}pre{white-space:pre-wrap;background:#f1f6ff;padding:18px;border-radius:10px}</style>
    <a href="/">← RAG 数据实验室</a><h1>回到原文</h1><p>虚构的技术分享语料。以下为固定演示快照，不是实际业务实时状态。</p>
    {% for row in rows %}<article><h2>{{ row.title }}</h2><small>{{ row.id }} · {{ row.status }}</small><p>{{ row.text }}</p><p><a href="{{ url_for('index', chunk=row.id) }}">在原文工作区定位此段 →</a></p><pre>来源：{{ row.source_id }}
    记录时间：{{ row.created_at }}
    有效区间：[{{ row.valid_from }}, {{ row.valid_to or '未设结束时间' }})</pre></article>{% endfor %}</html>''', rows=rows)


@app.get('/api/status')
def status():
    with graph().session(database=database()) as session:
        counts = session.run('MATCH (n:RagDemo) OPTIONAL MATCH (n)-[r]->(:RagDemo) RETURN count(DISTINCT n) AS nodes, count(DISTINCT r) AS relationships').single()
    count = milvus().query(collection_name=COLLECTION, filter='', output_fields=['count(*)'])[0]['count(*)']
    return jsonify(milvus_rows=count, graph_nodes=counts['nodes'], graph_relationships=counts['relationships'], embedding_model=MODEL, embedding_dimensions=DIMENSIONS)


@app.post('/api/search')
def search():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify(error='请求内容需为 JSON 对象。'), 400
    query = payload.get('query', '')
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 500:
        return jsonify(error='请输入 1～500 字的问题。'), 400
    try:
        k = int(payload.get('k', 3))
    except (TypeError, ValueError):
        return jsonify(error='k 必须是整数。'), 400
    if not 1 <= k <= 5:
        return jsonify(error='k 范围为 1～5。'), 400
    query = query.strip()
    started = time.perf_counter()
    with search_lock:
        vector = embedder().embed_query(query)
        hits = milvus().search(collection_name=COLLECTION, data=[vector], limit=k, output_fields=['id', 'title', 'text', 'source_id', 'status', 'valid_from', 'valid_to'], search_params={'metric_type': 'COSINE', 'params': {}})[0]
        matches = [dict(hit['entity'], score=round(hit['distance'], 4)) for hit in hits]
        results = retriever().search(query_vector=vector, top_k=k)
        expanded = [json.loads(item.content) for item in results.items]
    return jsonify(query=query, milvus=matches, graph=expanded, elapsed_ms=round((time.perf_counter() - started) * 1000))


@app.get('/api/temporal')
def temporal():
    at = request.args.get('at', '2026-09-14T12:00:00+08:00')
    scope = request.args.get('scope', '试点接入客户')
    if scope not in ('试点接入客户', '标准接入客户'):
        return jsonify(error='未知的客户范围。'), 400
    try:
        point = datetime.fromisoformat(at)
        if point.tzinfo is None:
            raise ValueError('Timezone required')
    except ValueError:
        return jsonify(error='时间需使用带时区的 ISO 8601 格式。'), 400
    with graph().session(database=database()) as session:
        rows = session.run('''
            MATCH (d:RagDemo:Decision)-[r:APPLIES_TO]->(s:RagDemo:CustomerScope {name: $scope})
            WHERE datetime(r.valid_from) <= datetime($at)
              AND (r.valid_to = '' OR datetime($at) < datetime(r.valid_to))
            RETURN d.decision AS name, r.valid_from AS valid_from, r.valid_to AS valid_to, r.source_ids AS source_ids
            ORDER BY r.valid_from
        ''', scope=scope, at=at).data()
    return jsonify(at=at, scope=scope, decisions=rows)


@app.errorhandler(Exception)
def failure(error):
    from werkzeug.exceptions import HTTPException
    if isinstance(error, HTTPException):
        return jsonify(error=error.description), error.code
    logging.exception('Demo query failed')
    return jsonify(error='查询失败，请检查演示服务是否已启动；详细原因见 .run/app.log。'), 503


if __name__ == '__main__':
    embedder()  # Offline model warmup before accepting requests.
    app.run(host=os.environ.get('RAG_DEMO_BIND', '127.0.0.1'), port=8018, debug=False, threaded=True)
