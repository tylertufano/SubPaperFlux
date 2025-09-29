#!/usr/bin/env bash
set -euo pipefail

# Helper for maintaining a vendored SDK under web/sdk
# Usage:
#   scripts/vendor_sdk_web.sh postprocess
#   scripts/vendor_sdk_web.sh generate [OPENAPI_SPEC] [OUT_DIR]

cmd=${1:-}
OPENAPI_SPEC=${2:-./openapi.json}
OUT_DIR=${3:-./web/sdk}

postprocess() {
  # Remove conflicting apis barrel and prevent index.ts from re-exporting it
  if [ -f "$OUT_DIR/src/apis/index.ts" ]; then
    rm -f "$OUT_DIR/src/apis/index.ts"
  fi
  if [ -f "$OUT_DIR/src/index.ts" ]; then
    # Comment out the apis barrel export if present
    # Handle both './apis/index' and './apis'
    sed -i.bak "s|^export \* from './apis/index';$|// export * from './apis/index';|" "$OUT_DIR/src/index.ts" || true
    sed -i.bak "s|^export \* from './apis';$|// export * from './apis';|" "$OUT_DIR/src/index.ts" || true
    rm -f "$OUT_DIR/src/index.ts.bak"
  fi
  python3 "$(dirname "$0")/postprocess_ts_sdk.py" "$OUT_DIR"
  # Ensure a README is present to document vendoring
  cat > "$OUT_DIR/README.md" << 'EOF'
# Vendored SDK (Do Not Edit)

This directory contains a generated TypeScript SDK produced from the server OpenAPI spec.

Source: generated via OpenAPI Generator and copied into `web/sdk` for builds.

Do not hand-edit files here; changes will be overwritten on the next vendoring.

Update steps:
1. Export OpenAPI: `make openapi-export API_BASE=http://localhost:8000`
2. Generate directly into web: `make sdk-ts-web`
   - or copy existing generated SDK: `make sdk-vendor-web`

The vendoring script removes a conflicting apis barrel and tweaks exports for Next.js builds.
EOF
}

generate() {
  bash "$(dirname "$0")/generate_ts_sdk.sh" "$OPENAPI_SPEC" "$OUT_DIR"
  postprocess
}

case "$cmd" in
  postprocess)
    postprocess
    ;;
  generate)
    generate
    ;;
  *)
    echo "Usage: $0 {postprocess|generate [OPENAPI_SPEC] [OUT_DIR]}" >&2
    exit 2
    ;;
esac
