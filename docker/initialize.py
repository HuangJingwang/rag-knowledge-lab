"""Initialize this stack from bundled fictional data; never clear a database."""
import subprocess
import sys
from pathlib import Path

APP = Path('/opt/demo/app')
for script in ['graph/seed_graph.py', 'seed_vectors.py']:
    subprocess.run([sys.executable, str(APP / script)], cwd=APP, check=True)
print('Graph, vectors and indexes initialized. The website can start.', flush=True)
