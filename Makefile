SHELL := /bin/sh

export DATABASE_URL ?= sqlite:///./dev.db

.PHONY: api worker db-up db-down db-rev db-prepare-pg bookmarks-count bookmarks-export seed openapi-export sdk-ts sdk-ts-web sdk-vendor-web venv web-install dev-api dev-web dev test-e2e test-api test-api-postgres

api:
	uvicorn app.main:app --reload --port 8000

worker:
	python -m app.worker

db-up:
	@if [ -x .venv/bin/alembic ]; then \
	  .venv/bin/alembic upgrade head; \
	else \
	  alembic upgrade head; \
	fi

db-down:
	alembic downgrade -1

db-rev:
	alembic revision --autogenerate -m "update schema"

db-prepare-pg:
	python -m app.admin_cli

seed:
	python -m app.seed

openapi-export:
	@if [ -n "$(API_BASE)" ]; then \
	  curl -sS "$(API_BASE)/openapi.json" -o openapi.json; \
	else \
	  python -m scripts.export_openapi; \
	fi

sdk-ts:
	OPENAPI_SPEC=$${OPENAPI_SPEC:-./openapi.json}; \
	OUT_DIR=$${OUT_DIR:-./sdk/ts}; \
	bash scripts/generate_ts_sdk.sh $$OPENAPI_SPEC $$OUT_DIR

# Generate SDK directly into web/sdk (vendored)
sdk-ts-web:
	OPENAPI_SPEC=$${OPENAPI_SPEC:-./openapi.json}; \
	OUT_DIR=$${OUT_DIR:-./web/sdk}; \
	bash scripts/generate_ts_sdk.sh $$OPENAPI_SPEC $$OUT_DIR; \
	bash scripts/vendor_sdk_web.sh postprocess

# Copy existing generated SDK (sdk/ts) into web/sdk and postprocess for Next build
sdk-vendor-web:
	rm -rf web/sdk && mkdir -p web; \
	cp -R sdk/ts web/sdk; \
	bash scripts/vendor_sdk_web.sh postprocess

# ---- API helpers ----
# Required: API_BASE, TOKEN
# Optional filters: FEED_ID, SINCE, UNTIL, SEARCH, FUZZY
bookmarks-count:
	@if [ -z "$(API_BASE)" ] || [ -z "$(TOKEN)" ]; then echo "Usage: make bookmarks-count API_BASE=http://localhost:8000 TOKEN=... [FEED_ID=..] [SINCE=..] [UNTIL=..] [SEARCH=..] [FUZZY=true]"; exit 2; fi; \
	QS=""; \
	[ -n "$(FEED_ID)" ] && QS="$$QS&feed_id=$(FEED_ID)"; \
        [ -n "$(SINCE)" ] && QS="$$QS&since=$(SINCE)"; \
        [ -n "$(UNTIL)" ] && QS="$$QS&until=$(UNTIL)"; \
        [ -n "$(SEARCH)" ] && QS="$$QS&search=$(SEARCH)"; \
        [ -n "$(TAG_ID)" ] && QS="$$QS&tag_id=$(TAG_ID)"; \
        [ -n "$(FOLDER_ID)" ] && QS="$$QS&folder_id=$(FOLDER_ID)"; \
	[ -n "$(FUZZY)" ] && QS="$$QS&fuzzy=$(FUZZY)"; \
	URL="$(API_BASE)/bookmarks$${QS:+?$${QS#&}}"; \
	echo "HEAD $$URL"; \
	count=$$(curl -sS -I -H "Authorization: Bearer $(TOKEN)" "$$URL" | awk -F': ' '/^X-Total-Count:/ {gsub(/\r/,"",$$2); print $$2}'); \
	echo "Total: $$count"

# Required: API_BASE, TOKEN
# Optional: FORMAT=json|csv (default json), OUT=filename
# Filters: FEED_ID, SINCE, UNTIL, SEARCH, FUZZY
bookmarks-export:
	@if [ -z "$(API_BASE)" ] || [ -z "$(TOKEN)" ]; then echo "Usage: make bookmarks-export API_BASE=http://localhost:8000 TOKEN=... [FORMAT=json|csv] [OUT=file] [FEED_ID=..] [SINCE=..] [UNTIL=..] [SEARCH=..] [FUZZY=true]"; exit 2; fi; \
	FMT="$${FORMAT:-json}"; \
	QS="format=$$FMT"; \
	[ -n "$(FEED_ID)" ] && QS="$$QS&feed_id=$(FEED_ID)"; \
        [ -n "$(SINCE)" ] && QS="$$QS&since=$(SINCE)"; \
        [ -n "$(UNTIL)" ] && QS="$$QS&until=$(UNTIL)"; \
        [ -n "$(SEARCH)" ] && QS="$$QS&search=$(SEARCH)"; \
        [ -n "$(TAG_ID)" ] && QS="$$QS&tag_id=$(TAG_ID)"; \
        [ -n "$(FOLDER_ID)" ] && QS="$$QS&folder_id=$(FOLDER_ID)"; \
	[ -n "$(FUZZY)" ] && QS="$$QS&fuzzy=$(FUZZY)"; \
	URL="$(API_BASE)/bookmarks/export?$${QS}"; \
	if [ -n "$(OUT)" ]; then \
	  echo "GET $$URL -> $(OUT)"; \
	  curl -sS -H "Authorization: Bearer $(TOKEN)" "$$URL" -o "$(OUT)"; \
	else \
	  echo "GET $$URL"; \
	  curl -sS -H "Authorization: Bearer $(TOKEN)" "$$URL"; \
	fi

# ---- Local Dev Convenience ----

venv:
	@if [ ! -d .venv ]; then \
	  python3 -m venv .venv; \
	fi; \
	. .venv/bin/activate; \
	.venv/bin/python -m pip install -r requirements.api.txt -r requirements.txt

web-install:
	cd web && npm install

dev-api: venv
	DATABASE_URL=$${DATABASE_URL:-sqlite:///./dev.db} .venv/bin/alembic upgrade head
	DATABASE_URL=$${DATABASE_URL:-sqlite:///./dev.db} .venv/bin/uvicorn app.main:app --port 8000

dev-web: web-install
	cd web && \
	  NEXT_PUBLIC_API_BASE=$${NEXT_PUBLIC_API_BASE:-http://localhost:8000} \
	  NEXTAUTH_SECRET=$${NEXTAUTH_SECRET:-devsecret} \
	  OIDC_ISSUER=$${OIDC_ISSUER:-http://localhost/oidc} \
	  OIDC_CLIENT_ID=$${OIDC_CLIENT_ID:-local} \
	  OIDC_CLIENT_SECRET=$${OIDC_CLIENT_SECRET:-local} \
	  npm run dev

# Run API (background) and Web (foreground) together with sane defaults
dev: venv web-install
	bash -c 'set -euo pipefail; trap "kill 0" EXIT; \
	  DATABASE_URL=$${DATABASE_URL:-sqlite:///./dev.db} .venv/bin/alembic upgrade head; \
	  DATABASE_URL=$${DATABASE_URL:-sqlite:///./dev.db} .venv/bin/uvicorn app.main:app --port 8000 & \
	  cd web && \
	    NEXT_PUBLIC_API_BASE=$${NEXT_PUBLIC_API_BASE:-http://localhost:8000} \
	    NEXTAUTH_SECRET=$${NEXTAUTH_SECRET:-devsecret} \
	    OIDC_ISSUER=$${OIDC_ISSUER:-http://localhost/oidc} \
	    OIDC_CLIENT_ID=$${OIDC_CLIENT_ID:-local} \
	    OIDC_CLIENT_SECRET=$${OIDC_CLIENT_SECRET:-local} \
	    npm run dev'

test-e2e: venv web-install
        E2E_ARGS="$(ARGS)" bash -c 'set -euo pipefail; API_PID=; cleanup() { set +e; if [ -n "$$API_PID" ]; then kill "$$API_PID" 2>/dev/null || true; wait "$$API_PID" 2>/dev/null || true; fi; }; trap cleanup EXIT; \
          DB_URL=$${DATABASE_URL:-sqlite:///./dev.db}; \
          USE_SQLMODEL=0; \
	  case "$$DB_URL" in \
	    sqlite:*) \
	      echo "[test-e2e] Skipping Alembic for SQLite database ($$DB_URL); relying on SQLModel metadata"; \
	      USE_SQLMODEL=1; \
	      ;; \
	    *) \
	      DATABASE_URL=$$DB_URL .venv/bin/alembic upgrade head; \
	      ;; \
	  esac; \
	  if [ "$$USE_SQLMODEL" = 1 ]; then \
	    SQLMODEL_CREATE_ALL_VALUE=$${SQLMODEL_CREATE_ALL:-1}; \
	    DATABASE_URL=$$DB_URL SQLMODEL_CREATE_ALL=$$SQLMODEL_CREATE_ALL_VALUE .venv/bin/uvicorn app.main:app --port 8000 & \
	    API_PID=$$!; \
	  else \
	    DATABASE_URL=$$DB_URL .venv/bin/uvicorn app.main:app --port 8000 & \
	    API_PID=$$!; \
	  fi; \
	  until curl -sSf http://localhost:8000/status > /dev/null; do sleep 1; done; \
	  cd web && \
	    NEXT_PUBLIC_API_BASE=$${NEXT_PUBLIC_API_BASE:-http://localhost:3000} \
	    API_BASE=$${API_BASE:-http://localhost:8000} \
            NEXTAUTH_SECRET=$${NEXTAUTH_SECRET:-devsecret} \
            OIDC_ISSUER=$${OIDC_ISSUER:-http://localhost/oidc} \
            OIDC_CLIENT_ID=$${OIDC_CLIENT_ID:-local} \
            OIDC_CLIENT_SECRET=$${OIDC_CLIENT_SECRET:-local} \
            npm run test:e2e$${E2E_ARGS:+ -- $$E2E_ARGS}'

test-api:
	pytest $(ARGS)

test-api-postgres:
	@if [ -z "$(DATABASE_URL)" ]; then echo "DATABASE_URL must be set for Postgres tests"; exit 2; fi
	pytest -m postgres $(ARGS)
