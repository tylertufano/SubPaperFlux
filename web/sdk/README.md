# Vendored SDK (Do Not Edit)

This directory contains a generated TypeScript SDK produced from the server OpenAPI spec.

Source: generated via OpenAPI Generator and copied into `web/sdk` for builds.

Do not hand-edit files here; changes will be overwritten on the next vendoring.

Update steps:
1. Export OpenAPI: `make openapi-export API_BASE=http://localhost:8000`
2. Generate directly into web: `make sdk-ts-web`
   - or copy existing generated SDK: `make sdk-vendor-web`

The vendoring script removes a conflicting apis barrel and tweaks exports for Next.js builds.
