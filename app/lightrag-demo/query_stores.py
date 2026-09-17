"""Query actual LightRAG entity/relation vector stores; no keyword LLM or generation."""
import asyncio, json, os
from pathlib import Path
BASE=Path(__file__).resolve().parent
async def main():
 os.chdir(BASE)
 import numpy as np
 from fastembed import TextEmbedding
 from lightrag import LightRAG
 from lightrag.utils import EmbeddingFunc
 from lightrag.constants import GRAPH_FIELD_SEP
 model=TextEmbedding(model_name='BAAI/bge-small-zh-v1.5',cache_dir=str(BASE.parent/'.cache/models'),providers=['CPUExecutionProvider'],threads=2,local_files_only=True)
 async def embed(texts,**kw):
  return np.asarray(list(model.query_embed(['为这个句子生成表示以用于检索相关文章：'+x for x in texts])),dtype=np.float32)
 async def no_llm(*a,**kw): raise RuntimeError('LLM disabled in storage query demo')
 rag=LightRAG(working_dir=str(BASE/'storage'),llm_model_func=no_llm,llm_model_name='not-configured',embedding_func=EmbeddingFunc(embedding_dim=512,max_token_size=512,func=embed,model_name='BAAI/bge-small-zh-v1.5'),embedding_batch_num=16,embedding_func_max_async=2,kv_storage='JsonKVStorage',vector_storage='NanoVectorDBStorage',graph_storage='NetworkXStorage',doc_status_storage='JsonDocStatusStorage')
 await rag.initialize_storages()
 try:
  export=json.loads((BASE/'export.json').read_text()); mapping={s['id']:s['original_id'] for s in export['sources']}
  entities=await rag.entities_vdb.query('支付回调改造',top_k=3)
  relations=await rag.relationships_vdb.query('任务依赖,主动查询补偿',top_k=3)
  result={'entities':[],'relations':[],'low_keyword':'支付回调改造','high_keyword':'任务依赖,主动查询补偿','llm_calls':0}
  for kind,hits in [('entities',entities),('relations',relations)]:
   for hit in hits:
    if kind=='entities': raw=(await rag.get_entity_info(hit['entity_name']))['graph_data']; title=hit['entity_name']
    else: raw=(await rag.get_relation_info(hit['src_id'],hit['tgt_id']))['graph_data']; title=hit['src_id']+' ↔ '+hit['tgt_id']
    result[kind].append({'title':title,'text':raw.get('description',''),'keywords':raw.get('keywords',''),'score':float(hit['distance']),'source_ids':[mapping[x] for x in raw.get('source_id','').split(GRAPH_FIELD_SEP) if x in mapping]})
  print('RESULT_JSON:'+json.dumps(result,ensure_ascii=False))
 finally: await rag.finalize_storages()
asyncio.run(main())
