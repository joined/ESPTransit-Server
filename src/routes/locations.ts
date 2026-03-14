import type { FastifyInstance } from "fastify";
import type { HafasClient } from "hafas-client";
import type Redis from "ioredis";
import {
    type LocationResult,
    readLocationsCache,
    writeLocationsCache,
} from "../cache/locations.js";
import type { Config } from "../config.js";
import { recordCacheLookup } from "../observability.js";

interface LocationsQuery {
    query: string;
    results?: string;
    stops?: string;
    poi?: string;
    addresses?: string;
    linesOfStops?: string;
}

export function registerLocationsRoute(
    app: FastifyInstance,
    hafas: HafasClient,
    redis: Redis,
    config: Config,
): void {
    app.get<{ Querystring: LocationsQuery }>(
        "/locations",
        {
            schema: {
                tags: ["locations"],
                description:
                    "Search for stations, stops, POIs, and addresses by name. Results are cached for 1 hour.",
                querystring: {
                    type: "object",
                    required: ["query"],
                    properties: {
                        query: {
                            type: "string",
                            description: "Search text (e.g. 'Alexanderplatz')",
                        },
                        results: {
                            type: "string",
                            description: "Max number of results (default: 5)",
                        },
                        stops: {
                            type: "string",
                            description:
                                "Include stops/stations (default: true, set to 'false' to exclude)",
                        },
                        poi: {
                            type: "string",
                            description:
                                "Include points of interest (default: true, set to 'false' to exclude)",
                        },
                        addresses: {
                            type: "string",
                            description:
                                "Include addresses (default: true, set to 'false' to exclude)",
                        },
                        linesOfStops: {
                            type: "string",
                            description:
                                "Include lines serving each stop/station (default: false, set to 'true' to include)",
                        },
                    },
                },
                response: {
                    200: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: true,
                            properties: {
                                type: {
                                    type: "string",
                                    description:
                                        'FPTF type: "stop", "station", "location", or "address"',
                                },
                                id: {
                                    type: "string",
                                    description: "Unique location identifier",
                                },
                                name: {
                                    type: "string",
                                    description: "Location name",
                                },
                                location: {
                                    type: "object",
                                    additionalProperties: true,
                                    description: "Geographic coordinates",
                                    properties: {
                                        type: { type: "string" },
                                        id: { type: "string" },
                                        latitude: { type: "number" },
                                        longitude: { type: "number" },
                                    },
                                },
                                products: {
                                    type: "object",
                                    additionalProperties: true,
                                    description:
                                        "Available transport modes (keys vary by HAFAS profile, values are booleans)",
                                },
                                station: {
                                    type: "object",
                                    additionalProperties: true,
                                    description:
                                        "Parent station (on stops that belong to a station)",
                                    properties: {
                                        type: { type: "string" },
                                        id: { type: "string" },
                                        name: { type: "string" },
                                    },
                                },
                                lines: {
                                    type: "array",
                                    description:
                                        "Transit lines serving this stop/station",
                                    items: {
                                        type: "object",
                                        additionalProperties: true,
                                        properties: {
                                            type: { type: "string" },
                                            id: { type: "string" },
                                            name: { type: "string" },
                                            mode: { type: "string" },
                                            product: { type: "string" },
                                        },
                                    },
                                },
                                poi: {
                                    type: "boolean",
                                    description:
                                        "Whether this is a point of interest (on type=location)",
                                },
                                address: {
                                    type: "string",
                                    description:
                                        "Street address (on type=location)",
                                },
                                distance: {
                                    type: "number",
                                    description:
                                        "Distance in meters (when available)",
                                },
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
                query,
                results: resultsStr,
                stops: stopsStr,
                poi: poiStr,
                addresses: addressesStr,
                linesOfStops: linesOfStopsStr,
            } = request.query;

            if (!query.trim()) {
                return reply
                    .status(400)
                    .send({ error: "query must not be empty" });
            }

            const results = resultsStr ? parseInt(resultsStr, 10) : 5;
            const stops = stopsStr !== "false";
            const poi = poiStr !== "false";
            const addresses = addressesStr !== "false";
            const linesOfStops = linesOfStopsStr === "true";

            const opts = { results, stops, poi, addresses, linesOfStops };

            const cached = await readLocationsCache(
                redis,
                config.profile,
                query,
                opts,
            );
            if (cached) {
                recordCacheLookup("locations", "hit");
                reply.header("X-Cache", "HIT");
                return cached;
            }
            recordCacheLookup("locations", "miss");

            const locations = await hafas.locations(query, opts);

            await writeLocationsCache(
                redis,
                config.profile,
                query,
                opts,
                locations as LocationResult,
                config.locationsCacheTtl,
            );

            reply.header("X-Cache", "MISS");
            return locations;
        },
    );
}
