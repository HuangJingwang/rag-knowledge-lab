#!/usr/bin/env python3
"""Actually import a small manually curated KG through LightRAG, then inspect stores.

No LLM is configured. This demonstrates real LightRAG storage, not extraction.
The example only writes inside lightrag-demo; embedding weights are read from
../.cache/models. It does not load the parent .env or any hosted-model credential.
"""
import asyncio
import json
import os
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

BASE = Path(__file__).resolve().parent
PROJECT = BASE.parent
MODEL_NAME = 'BAAI/bge-small-zh-v1.5'
SELECTED_CHUNKS = [3, 11, 17, 18, 19]
# Source endpoints and citations are validated before conversion.
RELATION_SPEC = {
    ('demo:person:chen-yu', 'RESPONSIBLE_FOR', 'demo:task:query-api'): (17, '负责人,任务分工', '陈宇负责支付结果查询接口开发，接口已在 9 月 15 日交付。'),
    ('demo:task:query-api', 'DELIVERS', 'demo:interface:query'): (17, '接口交付,查询能力', '支付结果查询接口开发任务交付支付结果查询接口，供回调补偿使用。'),
    ('demo:person:li-ming', 'RESPONSIBLE_FOR', 'demo:task:callback'): (18, '负责人,任务分工', '李明负责支付回调改造，截至 9 月 16 日仍在联调。'),
    ('demo:task:callback', 'DEPENDS_ON', 'demo:interface:query'): (18, '任务依赖,主动查询补偿', '支付回调改造依赖支付结果查询接口完成主动查询补偿联调。'),
    ('demo:task:callback', 'DEPENDS_ON', 'demo:task:query-api'): (18, '任务依赖,前置交付', '支付回调改造的补偿联调需要支付结果查询接口开发任务先完成。'),
    ('demo:person:wang-lei', 'RESPONSIBLE_FOR', 'demo:task:acceptance'): (19, '负责人,验收组织', '王蕾负责组织支付联调验收，截至 9 月 16 日验收待开始。'),
    ('demo:task:acceptance', 'DEPENDS_ON', 'demo:task:callback'): (19, '任务依赖,验收前置条件', '支付联调验收需要支付回调改造完成，后者仍在联调。'),
    ('demo:task:acceptance', 'DEPENDS_ON', 'demo:task:query-api'): (19, '任务依赖,验收前置条件', '支付联调验收需要支付结果查询接口交付；这一前置任务已完成。'),
    ('demo:doc:acceptance-plan', 'BASED_ON', 'demo:doc:query-contract'): (11, '文档依据,状态判断', '支付联调验收规范中的状态判断依据接口查询约定，引用查询状态与幂等规则。'),
}
ENTITY_SPEC = {
    'demo:person:chen-yu': (17, '陈宇是支付结果查询接口开发任务的负责人。'),
    'demo:task:query-api': (17, '支付结果查询接口开发任务由陈宇负责，9 月 15 日已交付。'),
    'demo:interface:query': (3, '按照支付流水号返回处理中、成功或失败；回调改造用它主动查询支付结果。'),
    'demo:person:li-ming': (18, '李明是支付回调改造任务的负责人。'),
    'demo:task:callback': (18, '支付回调改造包含主动查询补偿和重复回调去重，截至 9 月 16 日处于联调中。'),
    'demo:person:wang-lei': (19, '王蕾负责组织支付联调验收。'),
    'demo:task:acceptance': (19, '支付联调验收依赖查询接口和回调改造完成，截至 9 月 16 日待开始。'),
    'demo:doc:acceptance-plan': (11, '支付联调验收规范描述回调丢失、重复回调、查询超时用例。'),
    'demo:doc:query-contract': (3, '接口查询约定说明查询状态的含义，以及重复查询和重复回调不得重复发货。'),
}


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def build_custom_kg():
    documents = {row['id']: row for row in json.loads((PROJECT / 'data/documents.json').read_text())}
    graph = json.loads((PROJECT / 'data/graph.json').read_text())
    nodes = {row['id']: row for row in graph['nodes']}
    source_relations = {(row['start'], row['type'], row['end']): row for row in graph['relationships']}
    source_dir = BASE / 'sources'
    source_dir.mkdir(exist_ok=True)
    chunks = []
    for number in SELECTED_CHUNKS:
        doc = documents[f'demo:chunk:{number:02d}']
        path = f'sources/chunk-{number:02d}.md'
        content = f"# {doc['title']}\n\n{doc['text']}"
        (BASE / path).write_text(content + '\n')
        chunks.append(dict(content=content, source_id=doc['id'], file_path=path, chunk_order_index=0))
    entities = []
    for identifier, (number, description) in ENTITY_SPEC.items():
        node = nodes[identifier]
        entities.append(dict(entity_name=node['name'], entity_type=node['label'], description=description, source_id=f'demo:chunk:{number:02d}', file_path=f'sources/chunk-{number:02d}.md'))
    relationships = []
    for (start, kind, end), (number, keywords, description) in RELATION_SPEC.items():
        source = source_relations[(start, kind, end)]
        assert f'demo:chunk:{number:02d}' in source['source_ids']
        relationships.append(dict(src_id=nodes[start]['name'], tgt_id=nodes[end]['name'], description=description, keywords=keywords, weight=1.0, source_id=f'demo:chunk:{number:02d}', file_path=f'sources/chunk-{number:02d}.md'))
    payload = dict(chunks=chunks, entities=entities, relationships=relationships)
    write_json(BASE / 'custom_kg.json', payload)
    return payload, documents


async def main():
    # LightRAG's module-level dotenv lookup must not pick up the parent's .env.
    # An empty local file anchors discovery inside this isolated demonstration.
    os.chdir(BASE)
    (BASE / '.env').touch(exist_ok=True)
    from fastembed import TextEmbedding
    import numpy as np
    from lightrag import LightRAG
    from lightrag.utils import EmbeddingFunc, compute_mdhash_id
    from lightrag.kg.shared_storage import initialize_pipeline_status
    from lightrag.constants import GRAPH_FIELD_SEP

    model = TextEmbedding(model_name=MODEL_NAME, cache_dir=str(PROJECT / '.cache/models'), providers=['CPUExecutionProvider'], threads=2, local_files_only=True)
    calls = {'embedding': 0, 'llm': 0}

    async def embed(texts, **kwargs):
        calls['embedding'] += 1
        context = kwargs.get('context', 'document')
        def calculate():
            if context == 'query':
                values = model.query_embed(['为这个句子生成表示以用于检索相关文章：' + t for t in texts])
            else:
                values = model.passage_embed(texts, batch_size=16)
            return np.asarray(list(values), dtype=np.float32)
        return await asyncio.to_thread(calculate)

    async def no_llm(*args, **kwargs):
        calls['llm'] += 1
        raise RuntimeError('No LLM is configured: this demo imports manually curated custom KG data only.')

    payload, documents = build_custom_kg()
    rag = LightRAG(working_dir=str(BASE / 'storage'), llm_model_func=no_llm, llm_model_name='not-configured', embedding_func=EmbeddingFunc(embedding_dim=512, max_token_size=512, func=embed, model_name=MODEL_NAME), embedding_batch_num=16, embedding_func_max_async=2, kv_storage='JsonKVStorage', vector_storage='NanoVectorDBStorage', graph_storage='NetworkXStorage', doc_status_storage='JsonDocStatusStorage')
    await rag.initialize_storages()
    await initialize_pipeline_status()
    try:
        await rag.ainsert_custom_kg(payload, full_doc_id='demo-custom-kg-payment')
        # ainsert_custom_kg persists stores. Read through real LightRAG APIs.
        async def vector_record(store, storage_id):
            vectors = await store.get_vectors_by_ids([storage_id])
            raw = await store.get_by_id(storage_id)
            values = vectors.get(storage_id)
            assert raw is not None and values is not None, storage_id
            assert len(values) == 512, storage_id
            return dict(id=storage_id, dimensions=len(values), head=[float(v) for v in values[:8]])

        entities = []
        for item in payload['entities']:
            name = item['entity_name']
            raw = (await rag.get_entity_info(name))['graph_data']
            entities.append(dict(name=name, type=raw.get('entity_type'), description=raw.get('description'), source_ids=raw.get('source_id', '').split(GRAPH_FIELD_SEP), file_path=raw.get('file_path'), vector=await vector_record(rag.entities_vdb, compute_mdhash_id(name, prefix='ent-')), raw=raw))
        relations = []
        for item in payload['relationships']:
            first, second = sorted((item['src_id'], item['tgt_id']))
            raw = (await rag.get_relation_info(first, second))['graph_data']
            relations.append(dict(source=first, target=second, description=raw.get('description'), keywords=raw.get('keywords'), weight=raw.get('weight'), source_ids=raw.get('source_id', '').split(GRAPH_FIELD_SEP), file_path=raw.get('file_path'), vector=await vector_record(rag.relationships_vdb, compute_mdhash_id(first + second, prefix='rel-')), raw=raw))
        sources = []
        for item in payload['chunks']:
            stored_id = compute_mdhash_id(item['content'], prefix='chunk-')
            raw = await rag.text_chunks.get_by_id(stored_id)
            assert raw is not None
            doc = documents[item['source_id']]
            sources.append(dict(id=stored_id, original_id=item['source_id'], title=doc['title'], content=raw['content'], file_path=raw['file_path'], raw=raw))
        export = dict(framework='LightRAG', framework_version=version('lightrag-hku'), method='ainsert_custom_kg', generated_at=datetime.now(timezone.utc).isoformat(), data_origin='manually curated fictional custom KG; no automatic LLM extraction', graph_storage='NetworkXStorage', vector_storage='NanoVectorDBStorage', kv_storage='JsonKVStorage', directed=False, embedding_model=MODEL_NAME, embedding_dimensions=512, llm_configured=False, calls=calls, entities=entities, relations=relations, sources=sources, source_links={'custom_kg_api':f"https://github.com/HKUDS/LightRAG/blob/v{version('lightrag-hku')}/lightrag/lightrag.py",'graph_storage':f"https://github.com/HKUDS/LightRAG/blob/v{version('lightrag-hku')}/lightrag/kg/networkx_impl.py",'vector_storage':f"https://github.com/HKUDS/LightRAG/blob/v{version('lightrag-hku')}/lightrag/kg/nano_vector_db_impl.py"})
        assert calls['llm'] == 0
        assert len({v['name'] for v in entities}) == 9 and len(relations) == 9 and len(sources) == 5
        assert all(source_id in {s['id'] for s in sources} for item in entities + relations for source_id in item['source_ids'])
        write_json(BASE / 'export.json', export)
        print(f"LightRAG {export['framework_version']}: {len(entities)} entities, {len(relations)} relations, {len(sources)} source chunks; 512-dimensional vectors read from actual stores; LLM calls = {calls['llm']}.")
        print('Export: ' + str(BASE / 'export.json'))
    finally:
        await rag.finalize_storages()


if __name__ == '__main__':
    asyncio.run(main())
