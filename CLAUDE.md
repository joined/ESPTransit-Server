# ESPTransit Server

TypeScript Fastify server wrapping hafas-client with Redis caching. Single Docker image parameterized by `HAFAS_PROFILE` env var.

> Private/vendor-specific context (not committed) lives in `CLAUDE.local.md`.

## Commands

```bash
bun dev           # dev server (requires HAFAS_PROFILE env var)
bun start         # same — bun runs TypeScript natively, no build step
bun typecheck     # tsc --noEmit for type checking
bun lint          # biome check (linting + formatting)
```

Dev example:
```bash
HAFAS_PROFILE=bvg bun dev
```

## Architecture

```
GET /departures?stops=id1,id2&duration=10
GET /locations?query=text&results=5
GET /health
```

- **Caching**: ioredis, no cached-hafas-client dependency
  - Departures: 30s time-bucketed keys, dynamic TTL (`2 * sqrt(secsAway)` seconds)
  - Locations: simple key/value, 1h TTL
  - Redis unavailable → graceful fallback to direct HAFAS calls (no crash)
- **Response header**: `X-Cache: HIT` or `MISS`

## Observability

The server includes OpenTelemetry logs + metrics + traces export over OTLP/HTTP.

Set these env vars to enable export:

```bash
OTLP_ENDPOINT=https://<your-otlp-endpoint>/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64(user:key)>
```

Optional tuning:

```bash
OBSERVABILITY_ENABLED=true
OTEL_SERVICE_NAME=esptransit-server
OTEL_SERVICE_NAMESPACE=
OTEL_DEPLOYMENT_ENVIRONMENT=production
OTEL_EXPORT_INTERVAL_MS=15000
OTEL_EXPORT_TIMEOUT_MS=10000
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

When credentials are not set, observability remains disabled and the server still runs normally.

To emit custom application logs from code, use:

```ts
import { logInfo, logWarn, logError } from "./observability.js";
```

These functions write to stdout/stderr and OTLP logs.

## Linting

- **Biome** for linting and formatting (4-space indent, semicolons required, double quotes)
- Pre-commit hook via mise `prek` task runs `biome check`
- CI: GitHub Actions workflow runs Biome on push/PR to `main`
- Auto-fix: `bun biome check --write`

## Key facts

- hafas-client profiles export a **named** `profile` object — `import { profile } from 'hafas-client/p/bvg/index.js'`
- `@types/hafas-client`: departure items are typed as `Alternative`, not `Departure`
- hafas-client is ESM-only; project `"type": "module"`
- tsconfig uses `"moduleResolution": "bundler"`

## Deployment

The `docker-compose.yml` is ready for self-hosted deployment behind a reverse proxy (Traefik, Caddy, nginx, etc.) that handles TLS/routing.

To add a new profile, duplicate the `bvg` service block and change `HAFAS_PROFILE`.

Available profiles: `avv bls bvg cfl db insa ivb kvb nahsh nvv oebb pkp rejseplanen rmv sncb svv tpg vbb vbn vmt vor vrn vsn vvt zvv` (and more — see `src/config.ts`).
