from app import app
from demo_common import embedder

# Fail startup visibly if the packaged model is missing, instead of first-query failure.
embedder()
