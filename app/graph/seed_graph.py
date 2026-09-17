#!/usr/bin/env python3
"""Seed only namespaced, fictional :RagDemo nodes. Never deletes existing data.

Run from any directory. Reads ../.env without displaying credentials.
NEO4J_URI, NEO4J_USER (or NEO4J_USERNAME), NEO4J_PASSWORD, NEO4J_DATABASE.
Install dependency in your environment: pip install neo4j
"""
import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
LABELS = {'Project', 'Goal', 'Person', 'Interface', 'System', 'CustomerScope', 'Decision', 'Document', 'Meeting', 'Task', 'Chunk'}
RELATIONSHIPS = {'INVALIDATES', 'LEAVES', 'SUPPORTS', 'MANAGES', 'RESPONSIBLE_FOR', 'BELONGS_TO', 'PARTICIPATED_IN', 'DELIVERS', 'DEPENDS_ON', 'VERIFIES', 'SPECIFIED_BY', 'BASED_ON', 'PARTIALLY_OVERRIDES', 'CONFIRMED_IN', 'ABOUT', 'USES', 'SUPERSEDES', 'APPLIES_TO', 'EXCERPT_OF', 'MENTIONS'}


def read_env(path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        if line.startswith('export '):
            line = line[7:]
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
            value = value[1:-1]
        os.environ.setdefault(key, value)


def load_and_validate(data_dir):
    documents = json.loads((data_dir / 'documents.json').read_text())
    graph = json.loads((data_dir / 'graph.json').read_text())
    nodes = [dict(row, label='Chunk', name=row['title']) for row in documents] + graph['nodes']
    ids = [row['id'] for row in nodes]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate node IDs in demonstration data.')
    ids = set(ids)
    chunk_ids = {row['id'] for row in documents}
    rel_ids = set()
    for node in nodes:
        if not node['id'].startswith('demo:') or node['label'] not in LABELS or not node.get('name'):
            raise ValueError('Invalid demonstration node namespace, label, or name.')
    for relationship in graph['relationships']:
        if relationship['id'] in rel_ids or not relationship['id'].startswith('demo:'):
            raise ValueError('Invalid or duplicate demonstration relationship ID.')
        rel_ids.add(relationship['id'])
        if relationship['start'] not in ids or relationship['end'] not in ids or relationship['type'] not in RELATIONSHIPS:
            raise ValueError('Invalid demonstration relationship endpoint or type.')
        if not relationship.get('source_ids') or not set(relationship['source_ids']).issubset(chunk_ids):
            raise ValueError('Every demonstration relationship must reference existing source chunks.')
    return nodes, graph['relationships']


def seed(tx, nodes_by_label, rels_by_type):
    for label, rows in nodes_by_label.items():
        # Labels/types are allowlisted above; all actual data is parameterized.
        tx.run(f'UNWIND $rows AS row MERGE (n:RagDemo {{id: row.id}}) SET n:{label} SET n += row.properties', rows=rows).consume()
    for relation_type, rows in rels_by_type.items():
        tx.run(f'''UNWIND $rows AS row
            MATCH (a:RagDemo {{id: row.start}}), (b:RagDemo {{id: row.end}})
            MERGE (a)-[r:{relation_type} {{id: row.id}}]->(b)
            SET r += row.properties''', rows=rows).consume()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, default=BASE / '.env')
    parser.add_argument('--data-dir', type=Path, default=BASE / 'data')
    parser.add_argument('--dry-run', action='store_true', help='Validate local data without connecting or installing a driver.')
    args = parser.parse_args()
    nodes, relationships = load_and_validate(args.data_dir)
    if args.dry_run:
        print(f'Validated {len(nodes)} nodes, {len(relationships)} sourced relationships. No database writes.')
        return
    read_env(args.env)
    password = os.environ.get('NEO4J_PASSWORD')
    if not password:
        parser.error('NEO4J_PASSWORD is required in the environment or .env; its value will never be printed.')
    try:
        from neo4j import GraphDatabase
    except ImportError:
        parser.error('Missing Neo4j Python driver. Install with: pip install neo4j')
    grouped_nodes, grouped_relationships = defaultdict(list), defaultdict(list)
    for node in nodes:
        grouped_nodes[node['label']].append({'id': node['id'], 'properties': {k: v for k, v in node.items() if k != 'label'}})
    for relation in relationships:
        grouped_relationships[relation['type']].append({
            'id': relation['id'], 'start': relation['start'], 'end': relation['end'],
            'properties': {k: v for k, v in relation.items() if k not in {'start', 'end', 'type'}}})
    with GraphDatabase.driver(os.environ.get('NEO4J_URI', 'bolt://localhost:7687'), auth=(os.environ.get('NEO4J_USER', os.environ.get('NEO4J_USERNAME', 'neo4j')), password)) as driver:
        driver.verify_connectivity()
        with driver.session(database=os.environ.get('NEO4J_DATABASE', 'neo4j')) as session:
            session.run('CREATE CONSTRAINT rag_demo_id IF NOT EXISTS FOR (n:RagDemo) REQUIRE n.id IS UNIQUE').consume()
            session.execute_write(seed, grouped_nodes, grouped_relationships)
            counts = session.run('MATCH (n:RagDemo) OPTIONAL MATCH (n)-[r]->(:RagDemo) RETURN count(DISTINCT n) AS nodes, count(DISTINCT r) AS relationships').single()
    print(f"Imported fictional demo data. :RagDemo now has {counts['nodes']} nodes and {counts['relationships']} relationships.")
    print('No other labels or databases were cleared. Re-running updates the same namespaced IDs.')


if __name__ == '__main__':
    main()
