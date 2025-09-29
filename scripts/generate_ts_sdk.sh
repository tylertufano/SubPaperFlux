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
GENERATOR_VERSION=${GENERATOR_VERSION:-6.6.0}
GENERATOR_JAR=${GENERATOR_JAR:-.cache/openapi-generator-cli-${GENERATOR_VERSION}.jar}
GENERATOR=${GENERATOR:-typescript-fetch}
JAR_SOURCE_URL=${JAR_SOURCE_URL:-https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/${GENERATOR_VERSION}/openapi-generator-cli-${GENERATOR_VERSION}.jar}

resolve_java() {
  if [ -n "${JAVA_CMD:-}" ]; then
    echo "$JAVA_CMD"
    return
  fi

  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    echo "$JAVA_HOME/bin/java"
    return
  fi

  if command -v java >/dev/null 2>&1; then
    command -v java
    return
  fi

  echo "Java runtime not found. Install JDK 17+ or set JAVA_HOME/JAVA_CMD." >&2
  exit 1
}

mkdir -p "$OUT_DIR"

ensure_generator() {
  if [ -f "$GENERATOR_JAR" ]; then
    return
  fi

  local jar_dir
  jar_dir=$(dirname "$GENERATOR_JAR")
  mkdir -p "$jar_dir"

  local tmp_file
  tmp_file="${GENERATOR_JAR}.tmp"

  echo "Downloading OpenAPI Generator ${GENERATOR_VERSION}..."
  curl -fsSL "$JAR_SOURCE_URL" -o "$tmp_file"
  mv "$tmp_file" "$GENERATOR_JAR"
}

echo "Generating TypeScript SDK from $OPENAPI_SPEC into $OUT_DIR ..."
ensure_generator

JAVA_BIN=$(resolve_java)

"$JAVA_BIN" ${JAVA_OPTS:-} -jar "$GENERATOR_JAR" generate \
  -i "$OPENAPI_SPEC" \
  -g "$GENERATOR" \
  -o "$OUT_DIR" \
  --additional-properties=supportsES6=true,typescriptThreePlus=true,npmName=@subpaperflux/sdk,npmVersion=0.1.0 \
  --skip-validate-spec

python3 "$(dirname "$0")/postprocess_ts_sdk.py" "$OUT_DIR"

echo "Done. You can now 'cd $OUT_DIR' and build/publish the SDK."
