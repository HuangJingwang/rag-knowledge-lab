"""Upsert the shared fictional chunks into Milvus and Neo4j, without dropping data."""
import json
from pymilvus import DataType
from demo_common import BASE, MODEL, DIMENSIONS, COLLECTION, INDEX, LocalChineseEmbedder, milvus, graph, database


def main():
    documents = json.loads((BASE / 'data' / 'documents.json').read_text())
    print(f'Preparing {MODEL}, {DIMENSIONS} dimensions. Using packaged offline model weights.', flush=True)
    encoder = LocalChineseEmbedder(offline=True)
    vectors = encoder.embed_documents([row['title'] + '\n' + row['text'] for row in documents])
    client = milvus()
    if not client.has_collection(COLLECTION):
        schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
        for key in documents[0]:
            if isinstance(documents[0][key], bool):
                schema.add_field(field_name=key, datatype=DataType.BOOL)
            else:
                schema.add_field(field_name=key, datatype=DataType.VARCHAR, max_length=65535 if key == 'text' else 1024, is_primary=(key == 'id'))
        schema.add_field(field_name='embedding', datatype=DataType.FLOAT_VECTOR, dim=DIMENSIONS)
        indexes = client.prepare_index_params()
        indexes.add_index(field_name='embedding', index_type='FLAT', metric_type='COSINE')
        client.create_collection(collection_name=COLLECTION, schema=schema, index_params=indexes, consistency_level='Strong')
    else:
        fields = {field['name']: field for field in client.describe_collection(COLLECTION)['fields']}
        if int(fields['embedding']['params']['dim']) != DIMENSIONS:
            raise RuntimeError('Existing demo collection has a different dimension; refusing to overwrite.')
    rows = [dict(document, embedding=vector) for document, vector in zip(documents, vectors)]
    client.upsert(collection_name=COLLECTION, data=rows)
    client.flush(collection_name=COLLECTION)
    client.load_collection(collection_name=COLLECTION)
    print(f'Milvus: upserted {len(rows)} chunks into {COLLECTION}.', flush=True)
    with graph().session(database=database()) as session:
        count = session.run('MATCH (n:RagDemo:Chunk) WHERE n.id IN $ids RETURN count(n) AS n', ids=[row['id'] for row in documents]).single()['n']
        if count != len(documents):
            raise RuntimeError('Run graph/seed_graph.py first. Chunk IDs do not match.')
        session.run('UNWIND $rows AS row MATCH (n:RagDemo:Chunk {id: row.id}) SET n.embedding = row.embedding', rows=[{'id': row['id'], 'embedding': row['embedding']} for row in rows]).consume()
        session.run(f"CREATE VECTOR INDEX {INDEX} IF NOT EXISTS FOR (n:Chunk) ON (n.embedding) OPTIONS {{indexConfig: {{`vector.dimensions`: {DIMENSIONS}, `vector.similarity_function`: 'cosine'}}}}").consume()
        session.run('CALL db.awaitIndexes(120)').consume()
    print(f'Neo4j: updated the same {len(rows)} vectors; index {INDEX} is ready.', flush=True)


if __name__ == '__main__':
    main()
