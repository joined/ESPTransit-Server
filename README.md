# ESPTransit Server

Backend server for [ESPTransit](https://github.com/joined/ESPTransit) — a departure monitor built for ESP32P4 display modules. It provides a lightweight HTTP API for querying real-time public transit departures and station searches in Berlin/Brandenburg, and maybe elsewhere soon.

Built on top of [hafas-client](https://github.com/public-transport/hafas-client) by [@derhuerst](https://github.com/derhuerst).

## How it differs from hafas-client / hafas-rest-api

This server is purpose-built for departure displays:

- **Minimal surface area** — only two endpoints: `/departures` and `/locations`.
- **Multi-stop departures** — `/departures` accepts multiple comma-separated stop IDs, queries them in parallel, and returns a single merged, time-sorted list. This is the core use case: a single request to populate a display showing departures from nearby stops.
- **Redis caching** —
  - Departures use 30-second time-bucketed keys with a dynamic TTL based on how far away the next departure is (`2 * sqrt(secondsAway)` seconds).
  - Location searches are cached for 1 hour.
  - If Redis is unavailable, the server falls back to direct HAFAS calls without crashing.
- **Single Docker image, many networks** — one image parameterized by `HAFAS_PROFILE`. Spin up a BVG instance, a DB instance, and an OeBB instance from the same image.

## API

### `GET /departures`

Returns real-time departures for one or more stops, merged and sorted by time.

| Parameter  | Required | Default | Description                        |
| ---------- | -------- | ------- | ---------------------------------- |
| `stops`    | yes      |         | Comma-separated stop/station IDs   |
| `duration` | no       | `10`    | Lookahead window in minutes        |
| `when`     | no       | now     | ISO 8601 timestamp                 |
| `results`  | no       |         | Max results per stop               |

### `GET /locations`

Searches for stations, stops, POIs, and addresses.

| Parameter      | Required | Default | Description                          |
| -------------- | -------- | ------- | ------------------------------------ |
| `query`        | yes      |         | Search text                          |
| `results`      | no       | `5`     | Max number of results                |
| `stops`        | no       | `true`  | Include stops/stations               |
| `poi`          | no       | `true`  | Include points of interest           |
| `addresses`    | no       | `true`  | Include addresses                    |
| `linesOfStops` | no       | `false` | Include transit lines serving a stop |

All data endpoints return an `X-Cache: HIT` or `MISS` response header.

## Supported networks

Currently only `bvg` (Berlin) is deployed. The server supports any [hafas-client profile](https://github.com/public-transport/hafas-client/blob/6/p/readme.md) — to add one, duplicate the `bvg` service block in `docker-compose.yml` and change `HAFAS_PROFILE`.

## Running

Requires [Bun](https://bun.sh) and optionally Redis.

```bash
# Start the dev server (BVG profile)
HAFAS_PROFILE=bvg bun dev

# Type-check
bun typecheck

# Lint
bun lint
```

## Deployment

A `docker-compose.yml` is included for self-hosted deployment behind a reverse proxy. To add a network, duplicate an existing service block and change `HAFAS_PROFILE`.

## License

MIT
