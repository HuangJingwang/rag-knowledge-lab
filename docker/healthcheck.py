import json
from urllib.request import urlopen

with urlopen('http://127.0.0.1:8018/api/status', timeout=20) as response:
    status = json.load(response)
if status['milvus_rows'] < 1 or status['graph_nodes'] < 1:
    raise SystemExit('Database initialization is incomplete')
