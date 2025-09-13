#!/usr/bin/env bash
set -euo pipefail

# Generate a TypeScript SDK from an OpenAPI spec using openapi-generator.
# Usage:
#   scripts/generate_ts_sdk.sh [OPENAPI_SPEC] [OUT_DIR]
# Defaults:
#   OPENAPI_SPEC: ./openapi.json
#   OUT_DIR: ./sdk/ts

OPENAPI_SPEC=${1:-./openapi.json}
OUT_DIR=${2:-./sdk/ts}
GENERATOR_IMAGE=${GENERATOR_IMAGE:-openapitools/openapi-generator-cli:v6.6.0}
GENERATOR=${GENERATOR:-typescript-fetch}

mkdir -p "$OUT_DIR"

echo "Generating TypeScript SDK from $OPENAPI_SPEC into $OUT_DIR ..."
docker run --rm \
  -v "$(pwd)":/local \
  $GENERATOR_IMAGE generate \
  -i "/local/${OPENAPI_SPEC#./}" \
  -g "$GENERATOR" \
  -o "/local/${OUT_DIR#./}" \
  --additional-properties=supportsES6=true,typescriptThreePlus=true,npmName=@subpaperflux/sdk,npmVersion=0.1.0 \
  --skip-validate-spec

echo "Done. You can now 'cd $OUT_DIR' and build/publish the SDK."

