# pnsm-ai-svc -- common tasks.
#
# On Windows without make, run the command each target shows; every one is a
# single python or docker invocation. `make help` lists them.

PY ?= python
VENV ?= .venv
COMPOSE ?= docker compose

.DEFAULT_GOAL := help
.PHONY: help setup models keys lock lint format typecheck test test-fast verify \
        deps audit openapi golden calibrate bench-memory bench-bcrypt run up down \
        logs smoke build image-size frontend-image frontend-size manifests \
        provision rotate-dry clean ci

help: ## Show this list
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------------ setup
setup: ## Create the venv and install runtime + dev dependencies
	$(PY) -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -r requirements-dev.txt
	@echo "Next:  cp .env.example .env && $(PY) scripts/gen_keys.py >> .env"

models: ## Download the ONNX weights (~14 MB) and verify checksums
	$(PY) scripts/fetch_models.py

keys: ## Generate the four secrets as a .env fragment
	$(PY) scripts/gen_keys.py

lock: ## Regenerate the hash-pinned requirements.lock
	pip-compile --generate-hashes --output-file requirements.lock requirements.txt
	@echo "Commit requirements.lock -- the Docker build installs from it."

# ------------------------------------------------------------------ checks
lint: ## ruff
	ruff check app tests scripts calibration clients/python

format: ## ruff --fix
	ruff check --fix app tests scripts calibration clients/python
	ruff format app tests scripts calibration clients/python

typecheck: ## mypy over app/
	mypy

deps: ## Enforce the dependency blocklist (no tensorflow/torch/deepface)
	$(PY) scripts/check_deps.py

audit: ## Supply-chain gate: fail on a high or critical advisory (OWASP A03)
	$(PY) scripts/audit_deps.py --severity high

audit-all: ## Same, including Person 1/2/3's checkouts if they sit alongside
	$(PY) scripts/audit_deps.py --severity high --npm ../pnsm-web ../pnsm-mobile ../pnsm-api

test: ## Full pytest suite
	pytest

test-fast: ## Everything except the memory gate
	pytest --ignore=tests/memory

verify: ## Dependency-light suite; needs no pytest, fastapi, boto3 or bcrypt
	$(PY) scripts/verify_offline.py

ci: deps audit lint typecheck manifests test openapi-check ## Everything CI runs

openapi: ## Export docs/openapi.json from the live app
	$(PY) scripts/export_openapi.py

openapi-check: ## Fail if docs/openapi.json is stale
	$(PY) scripts/export_openapi.py --check

golden: ## Regenerate the golden preprocessing fixture (read the docstring first)
	$(PY) scripts/update_golden.py

# ------------------------------------------------------------ calibration
calibrate: ## Fit the cosine-to-confidence map on calibration/dataset
	$(PY) calibration/build_calibration.py --dataset calibration/dataset

calibrate-dry: ## Same, but report without writing
	$(PY) calibration/build_calibration.py --dataset calibration/dataset --dry-run

# ------------------------------------------------------------ benchmarks
bench-memory: ## Resident memory with the real ONNX sessions loaded
	$(PY) scripts/bench_memory.py

bench-bcrypt: ## Pick a bcrypt cost that fits the latency budget
	$(PY) scripts/bench_bcrypt.py

# --------------------------------------------------------------- running
run: ## Run the service locally with reload
	uvicorn app.main:app --reload --port 8000

up: ## Full stack: ai-svc + mock backend + MinIO
	$(COMPOSE) up --build

down: ## Stop the stack
	$(COMPOSE) down

logs: ## Tail the AI service logs
	$(COMPOSE) logs -f ai-svc

smoke: ## End-to-end smoke test against a running service
	$(PY) scripts/smoke.py

# ---------------------------------------------------------------- docker
build: ## Build the container image
	docker build -t pnsm-ai-svc:latest .

image-size: build ## Report the image size against the 450 MB target
	@docker image inspect pnsm-ai-svc:latest --format '{{.Size}}' | \
	  awk '{printf "image: %.1f MB (target < 450)\n", $$1/1048576}'

frontend-image: ## Build the P1/P2 frontend image against the smoke fixture
	@rm -rf .frontend-ctx && mkdir -p .frontend-ctx/deploy
	@cp -r tests/fixtures/frontend-smoke/. .frontend-ctx/
	@cp deploy/frontend.Dockerfile deploy/nginx.conf.template .frontend-ctx/deploy/
	docker build -f .frontend-ctx/deploy/frontend.Dockerfile \
	  --build-arg APP_NAME=pnsm-frontend \
	  --build-arg PNSM_API_ORIGIN=https://api.example.invalid \
	  --build-arg PNSM_S3_ORIGIN=https://selfies.example.invalid \
	  -t pnsm-frontend:latest .frontend-ctx
	@rm -rf .frontend-ctx

frontend-size: frontend-image ## Report it against the master plan's 50 MB ceiling
	@docker image inspect pnsm-frontend:latest --format '{{.Size}}' | \
	  awk '{printf "frontend image: %.1f MB (master plan: < 50)\n", $$1/1048576}'

# ------------------------------------------------------------------- aws
manifests: ## Validate every deploy/ template renders with no placeholder left
	$(PY) scripts/provision_aws.py --account-id 000000000000 \
	  --github-org pnsm-group8 --github-repo pnsm --check

provision: ## Render deploy/rendered/ and print the AWS CLI plan (creates nothing)
	$(PY) scripts/provision_aws.py --render --print-commands

rotate-dry: ## Re-wrap an exported FaceEmbeddings file to KMS, writing nothing
	$(PY) scripts/rotate_keys.py --in embeddings.json --to kms --dry-run

clean: ## Remove caches and build artefacts
	rm -rf .pytest_cache .ruff_cache .mypy_cache htmlcov .coverage \
	       deploy/rendered .frontend-ctx
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
