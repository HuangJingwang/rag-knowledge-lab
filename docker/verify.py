"""Smoke-test the packaged site, real retrieval, and all nine teaching cases."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

BASE_URL = os.environ.get('VERIFY_URL', 'http://127.0.0.1:8018')
APP = Path('/opt/demo/app')

def read(path, payload=None):
    request = Request(BASE_URL + path, data=None if payload is None else json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=150) as response:
        assert response.status == 200
        return response.read()

def api(path, payload=None):
    return json.loads(read(path, payload))

docs = json.loads((APP / 'data/documents.json').read_text())
graph = json.loads((APP / 'data/graph.json').read_text())
status = api('/api/status')
assert status['milvus_rows'] == len(docs), status
assert status['graph_nodes'] == len(docs) + len(graph['nodes']), status
assert status['graph_relationships'] == len(graph['relationships']), status
assert status['embedding_dimensions'] == 512
known = {row['id'] for row in docs}

for path in ['/', '/explore', '/entities', '/examples']:
    assert b'<!doctype html' in read(path).lower()
assert read('/article/') == Path('/opt/demo/article/article.html').read_bytes()
assert len(api('/api/documents')['documents']) == len(docs)
assert api('/api/entities')['entities']
hits = api('/api/search', {'query': '谁负责支付回调改造？', 'k': 3})
assert len(hits['milvus']) == 3 and len(hits['graph']) == 3
assert all(hit['id'] in known for hit in hits['milvus'] + hits['graph'])
assert any(hit['relations'] for hit in hits['graph'])
print('PASS pages, embedded article, 512D real vector search and Neo4j expansion', flush=True)

for case in api('/api/examples')['cases']:
    result = api('/api/examples/' + case['id'] + '/run', {'variant': ''})
    assert len(result['steps']) >= 3
    for step in result['steps']:
        for item in step['items']:
            assert set(item.get('source_ids', [])) <= known
        for edge in step.get('relations', []):
            assert set(edge['source_ids']) <= known
    if case['id'] == 'graph':
        assert result['steps'][1]['items']
    if case['id'] == 'light':
        assert all(step['items'] for step in result['steps'][:2])
        assert all('score' in item for step in result['steps'][:2] for item in step['items'])
    print('PASS case:', case['id'], flush=True)

expired = api('/api/examples/temporal/run', {'variant': 'expired'})
assert '没有覆盖' in expired['steps'][1]['items'][1]['text']
rule = api('/api/examples/page/run', {'variant': 'rule'})
section = api('/api/examples/page/run', {'variant': 'section'})
assert len(rule['steps'][2]['items']) == 1 and len(section['steps'][2]['items']) == 2
print('PASS time boundaries and PageIndex chapter scope', flush=True)
print(json.dumps(status, ensure_ascii=False), flush=True)
