FROM python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache
WORKDIR /opt/demo
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt && pip check
# Package tokenizer assets during build; runtime needs no model download.
RUN python -c "import tiktoken; tiktoken.get_encoding('cl100k_base'); tiktoken.get_encoding('o200k_base')"
RUN groupadd --gid 10001 demo && useradd --uid 10001 --gid demo --create-home demo
COPY --chown=demo:demo app ./app
COPY --chown=demo:demo article ./article
COPY --chown=demo:demo docker ./docker
RUN chown -R demo:demo /opt/tiktoken-cache
USER demo
WORKDIR /opt/demo/app
EXPOSE 8018
CMD ["gunicorn", "--bind", "0.0.0.0:8018", "--workers", "1", "--threads", "4", "--timeout", "180", "--access-logfile", "-", "--error-logfile", "-", "wsgi:app"]
