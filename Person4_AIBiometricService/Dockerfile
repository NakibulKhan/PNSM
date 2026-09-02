# syntax=docker/dockerfile:1
#
# pnsm-ai-svc -- AI biometrics, cryptography and DevOps service.
#
# Two stages so build tooling never reaches the runtime image. Target: under
# 450 MB on disk, under ~300 MB resident with both ONNX sessions loaded, on a
# Fargate task that requests 1024 MB (deploy/ecs-task-definition.json).
#
#   docker build -t pnsm-ai-svc .
#   docker run --rm -p 8000:8000 --env-file .env -m 1024m pnsm-ai-svc

# ---------------------------------------------------------------- stage 1
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential is needed by a handful of wheels that lack a manylinux build;
# it stays in this stage and never reaches the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt requirements.lock* ./

# Prefer the hash-pinned lock when it is committed; fall back to the ranges so
# a fresh clone still builds.
RUN python -m venv /opt/venv \
    && if [ -f requirements.lock ]; then \
         echo "installing from requirements.lock (hash-pinned)"; \
         /opt/venv/bin/pip install --require-hashes -r requirements.lock; \
       else \
         echo "WARNING: requirements.lock absent; installing from ranges"; \
         /opt/venv/bin/pip install -r requirements.txt; \
       fi

# ---------------------------------------------------------------- stage 2
FROM python:3.11-slim

# libgomp1  : OpenMP runtime, required by onnxruntime's CPU kernels
# libglib2.0-0: the one shared library opencv-python-headless still links
# curl      : HEALTHCHECK only
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 pnsm

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Weights are baked in at build time. A cold start must never depend on an
# external host being reachable -- that would turn a Hugging Face outage into
# a failed check-in.
COPY --chown=pnsm:pnsm models/ ./models/
COPY --chown=pnsm:pnsm calibration/ ./calibration/
COPY --chown=pnsm:pnsm app/ ./app/

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=random \
    # One thread everywhere. On half a vCPU extra threads add contention and
    # memory without buying any throughput.
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    PNSM_MODEL_DIR=/app/models \
    PNSM_CALIBRATION_PATH=/app/calibration/calibration.json

USER pnsm
EXPOSE 8000

# Hits /health, which never touches the model, so the probe costs nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Single worker on purpose: the ONNX sessions and the replay caches are
# process-local, and a second worker would double the memory for no gain on
# half a vCPU.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--timeout-keep-alive", "65", \
     "--no-access-log"]
