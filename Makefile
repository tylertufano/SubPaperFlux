SHELL := /bin/sh

export DATABASE_URL ?= sqlite:///./dev.db

.PHONY: api worker db-up db-down db-rev db-prepare-pg bookmarks-count bookmarks-export seed openapi-export sdk-ts sdk-ts-web sdk-vendor-web

api:
	uvicorn app.main:app --reload --port 8000

worker:
	python -m app.worker

db-up:
	alembic upgrade head

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
	[ -n "$(FUZZY)" ] && QS="$$QS&fuzzy=$(FUZZY)"; \
	URL="$(API_BASE)/bookmarks/export?$${QS}"; \
	if [ -n "$(OUT)" ]; then \
	  echo "GET $$URL -> $(OUT)"; \
	  curl -sS -H "Authorization: Bearer $(TOKEN)" "$$URL" -o "$(OUT)"; \
	else \
	  echo "GET $$URL"; \
	  curl -sS -H "Authorization: Bearer $(TOKEN)" "$$URL"; \
	fi
