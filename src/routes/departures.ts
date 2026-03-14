import type { FastifyInstance } from "fastify";
import type { Alternative, HafasClient } from "hafas-client";
import type Redis from "ioredis";
import {
    readDeparturesCache,
    writeDeparturesCache,
} from "../cache/departures.js";
import type { Config } from "../config.js";
import { recordCacheLookup } from "../observability.js";

interface DeparturesQuery {
    stops: string;
    duration?: string;
    when?: string;
    results?: string;
}

async function fetchStopDepartures(
    hafas: HafasClient,
    redis: Redis,
    profile: string,
    stopId: string,
    whenMs: number,
    duration: number,
    results: number | undefined,
): Promise<{ departures: readonly Alternative[]; cached: boolean }> {
    const extraOpts = { results };

    const fromCache = await readDeparturesCache(
        redis,
        profile,
        stopId,
        whenMs,
        duration,
        extraOpts,
    );
    if (fromCache) {
        recordCacheLookup("departures", "hit");
        return { departures: fromCache, cached: true };
    }
    recordCacheLookup("departures", "miss");

    const res = await hafas.departures(stopId, {
        when: new Date(whenMs),
        duration,
        results,
    });

    const departures = res.departures ?? [];
    await writeDeparturesCache(
        redis,
        profile,
        stopId,
        whenMs,
        duration,
        extraOpts,
        departures,
    );

    return { departures, cached: false };
}

export function registerDeparturesRoute(
    app: FastifyInstance,
    hafas: HafasClient,
    redis: Redis,
    config: Config,
): void {
    app.get<{ Querystring: DeparturesQuery }>(
        "/departures",
        {
            schema: {
                tags: ["departures"],
                description:
                    "Fetch real-time departures for one or more stops, sorted by time. Results are cached with dynamic TTL.",
                querystring: {
                    type: "object",
                    required: ["stops"],
                    properties: {
                        stops: {
                            type: "string",
                            description:
                                "Comma-separated stop IDs (e.g. '900000100003,900000100001')",
                        },
                        duration: {
                            type: "string",
                            description: "Minutes ahead to fetch (default: 10)",
                        },
                        when: {
                            type: "string",
                            description:
                                "ISO 8601 datetime for the query window start (default: now)",
                        },
                        results: {
                            type: "string",
                            description: "Max departures per stop (optional)",
                        },
                    },
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            departures: {
                                type: "array",
                                items: {
                                    type: "object",
                                    additionalProperties: true,
                                    properties: {
                                        tripId: {
                                            type: "string",
                                            description:
                                                "Unique trip identifier",
                                        },
                                        stop: {
                                            type: "object",
                                            additionalProperties: true,
                                            description:
                                                "Stop where this departure occurs",
                                            properties: {
                                                type: {
                                                    type: "string",
                                                    description:
                                                        'FPTF type: "stop" or "station"',
                                                },
                                                id: {
                                                    type: "string",
                                                    description: "Stop ID",
                                                },
                                                name: {
                                                    type: "string",
                                                    description: "Stop name",
                                                },
                                                location: {
                                                    type: "object",
                                                    additionalProperties: true,
                                                    description:
                                                        "Geographic coordinates",
                                                    properties: {
                                                        type: {
                                                            type: "string",
                                                        },
                                                        id: { type: "string" },
                                                        latitude: {
                                                            type: "number",
                                                        },
                                                        longitude: {
                                                            type: "number",
                                                        },
                                                    },
                                                },
                                                products: {
                                                    type: "object",
                                                    additionalProperties: true,
                                                    description:
                                                        "Available transport modes (boolean values, keys vary by profile)",
                                                },
                                            },
                                        },
                                        when: {
                                            type: "string",
                                            nullable: true,
                                            description:
                                                "Actual departure time (ISO 8601), null if cancelled",
                                        },
                                        plannedWhen: {
                                            type: "string",
                                            description:
                                                "Scheduled departure time (ISO 8601)",
                                        },
                                        prognosedWhen: {
                                            type: "string",
                                            nullable: true,
                                            description:
                                                "Prognosed departure time (ISO 8601)",
                                        },
                                        delay: {
                                            type: "integer",
                                            nullable: true,
                                            description:
                                                "Delay in seconds, null if unknown",
                                        },
                                        platform: {
                                            type: "string",
                                            nullable: true,
                                            description:
                                                "Actual platform/track",
                                        },
                                        plannedPlatform: {
                                            type: "string",
                                            nullable: true,
                                            description:
                                                "Scheduled platform/track",
                                        },
                                        prognosedPlatform: {
                                            type: "string",
                                            nullable: true,
                                            description:
                                                "Prognosed platform/track",
                                        },
                                        direction: {
                                            type: "string",
                                            description:
                                                "Direction text shown on the vehicle",
                                        },
                                        line: {
                                            type: "object",
                                            additionalProperties: true,
                                            description: "Transit line",
                                            properties: {
                                                type: {
                                                    type: "string",
                                                    description:
                                                        'FPTF type, e.g. "line"',
                                                },
                                                id: {
                                                    type: "string",
                                                    description: "Line ID",
                                                },
                                                name: {
                                                    type: "string",
                                                    description:
                                                        'Line name (e.g. "U2", "S1")',
                                                },
                                                mode: {
                                                    type: "string",
                                                    description:
                                                        'Transport mode (e.g. "train", "bus")',
                                                },
                                                product: {
                                                    type: "string",
                                                    description:
                                                        'Product category (e.g. "suburban", "subway")',
                                                },
                                                productName: {
                                                    type: "string",
                                                    description:
                                                        'Product name (e.g. "S-Bahn", "U-Bahn")',
                                                },
                                                symbol: {
                                                    type: "string",
                                                    description: "Line symbol",
                                                },
                                                directions: {
                                                    type: "array",
                                                    items: {
                                                        type: "string",
                                                    },
                                                    description:
                                                        "Known directions of the line",
                                                },
                                                operator: {
                                                    type: "object",
                                                    additionalProperties: true,
                                                    description:
                                                        "Transit operator",
                                                    properties: {
                                                        type: {
                                                            type: "string",
                                                            description:
                                                                'Always "operator"',
                                                        },
                                                        id: { type: "string" },
                                                        name: {
                                                            type: "string",
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        cancelled: {
                                            type: "boolean",
                                            description:
                                                "Whether this departure is cancelled",
                                        },
                                        loadFactor: {
                                            type: "string",
                                            description:
                                                'Occupancy level (e.g. "low-to-medium", "high")',
                                        },
                                        provenance: {
                                            type: "string",
                                            description:
                                                "Origin text (where the vehicle is coming from)",
                                        },
                                        origin: {
                                            type: "object",
                                            additionalProperties: true,
                                            description:
                                                "Origin stop/station/location",
                                            properties: {
                                                type: {
                                                    type: "string",
                                                    description:
                                                        'FPTF type: "stop", "station", or "location"',
                                                },
                                                id: {
                                                    type: "string",
                                                },
                                                name: {
                                                    type: "string",
                                                },
                                                location: {
                                                    type: "object",
                                                    additionalProperties: true,
                                                    properties: {
                                                        latitude: {
                                                            type: "number",
                                                        },
                                                        longitude: {
                                                            type: "number",
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        destination: {
                                            type: "object",
                                            additionalProperties: true,
                                            description:
                                                "Final destination stop/station/location",
                                            properties: {
                                                type: {
                                                    type: "string",
                                                    description:
                                                        'FPTF type: "stop", "station", or "location"',
                                                },
                                                id: {
                                                    type: "string",
                                                },
                                                name: {
                                                    type: "string",
                                                },
                                                location: {
                                                    type: "object",
                                                    additionalProperties: true,
                                                    properties: {
                                                        latitude: {
                                                            type: "number",
                                                        },
                                                        longitude: {
                                                            type: "number",
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        remarks: {
                                            type: "array",
                                            description:
                                                "Service alerts and status messages",
                                            items: {
                                                type: "object",
                                                additionalProperties: true,
                                                properties: {
                                                    type: {
                                                        type: "string",
                                                        description:
                                                            'Remark type: "hint", "status", or "warning"',
                                                    },
                                                    code: {
                                                        type: "string",
                                                        description:
                                                            "Remark code (on hint/status)",
                                                    },
                                                    text: {
                                                        type: "string",
                                                        nullable: true,
                                                        description:
                                                            "Full remark text (may be absent on warnings)",
                                                    },
                                                    summary: {
                                                        type: "string",
                                                        description:
                                                            "Short summary",
                                                    },
                                                    id: {
                                                        type: "string",
                                                        description:
                                                            "Warning ID (on warnings)",
                                                    },
                                                    category: {
                                                        type: "string",
                                                        nullable: true,
                                                        description:
                                                            "Warning category (on warnings)",
                                                    },
                                                    priority: {
                                                        type: "integer",
                                                        description:
                                                            "Warning priority (on warnings)",
                                                    },
                                                    validFrom: {
                                                        type: "string",
                                                        description:
                                                            "Warning validity start (ISO 8601, on warnings)",
                                                    },
                                                    validUntil: {
                                                        type: "string",
                                                        description:
                                                            "Warning validity end (ISO 8601, on warnings)",
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            realtimeDataUpdatedAt: {
                                type: "integer",
                                description: "Unix timestamp (seconds)",
                            },
                        },
                    },
                    400: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const {
                stops,
                duration: durationStr,
                when: whenStr,
                results: resultsStr,
            } = request.query;

            const stopIds = stops
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (stopIds.length === 0) {
                return reply.status(400).send({
                    error: "stops must be a non-empty comma-separated list",
                });
            }

            const duration = durationStr ? parseInt(durationStr, 10) : 10;
            if (Number.isNaN(duration) || duration <= 0) {
                return reply
                    .status(400)
                    .send({ error: "duration must be a positive integer" });
            }

            const whenMs = whenStr ? new Date(whenStr).getTime() : Date.now();
            if (Number.isNaN(whenMs)) {
                return reply
                    .status(400)
                    .send({ error: "when must be a valid ISO 8601 datetime" });
            }

            const results = resultsStr ? parseInt(resultsStr, 10) : undefined;

            const perStop = await Promise.all(
                stopIds.map((id) =>
                    fetchStopDepartures(
                        hafas,
                        redis,
                        config.profile,
                        id,
                        whenMs,
                        duration,
                        results,
                    ),
                ),
            );

            const allDepartures = perStop.flatMap((r) => [...r.departures]);
            allDepartures.sort((a, b) => {
                const ta = a.when ? new Date(a.when).getTime() : 0;
                const tb = b.when ? new Date(b.when).getTime() : 0;
                return ta - tb;
            });

            const allCached = perStop.every((r) => r.cached);
            reply.header("X-Cache", allCached ? "HIT" : "MISS");

            return {
                departures: allDepartures,
                realtimeDataUpdatedAt: Math.floor(Date.now() / 1000),
            };
        },
    );
}
