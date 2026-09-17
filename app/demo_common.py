"""Shared local connections and real Chinese text embeddings."""
import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv
from fastembed import TextEmbedding
from neo4j import GraphDatabase
from neo4j_graphrag.embeddings.base import Embedder
from pymilvus import MilvusClient

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / '.env')
MODEL = 'BAAI/bge-small-zh-v1.5'
DIMENSIONS = 512
COLLECTION = 'rag_demo_chunks'
INDEX = 'rag_demo_chunk_embedding'


class LocalChineseEmbedder(Embedder):
    def __init__(self, offline=True):
        super().__init__()
        self.model = TextEmbedding(model_name=MODEL, cache_dir=str(BASE / '.cache' / 'models'), providers=['CPUExecutionProvider'], threads=2, local_files_only=offline)

    def embed_query(self, text, **kwargs):
        query = '为这个句子生成表示以用于检索相关文章：' + text
        return next(self.model.query_embed(query)).tolist()

    def embed_documents(self, texts):
        return [vector.tolist() for vector in self.model.passage_embed(texts, batch_size=16)]


@lru_cache
def embedder():
    return LocalChineseEmbedder(offline=True)


@lru_cache
def milvus():
    return MilvusClient(uri=os.environ['MILVUS_URI'], timeout=20)


@lru_cache
def graph():
    return GraphDatabase.driver(os.environ['NEO4J_URI'], auth=(os.environ.get('NEO4J_USER', 'neo4j'), os.environ['NEO4J_PASSWORD']), connection_timeout=15)


def database():
    return os.environ.get('NEO4J_DATABASE', 'neo4j')
