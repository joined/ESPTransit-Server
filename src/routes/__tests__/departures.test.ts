import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { HafasClient } from "hafas-client";
import type Redis from "ioredis";
import type { Config } from "../../config.js";
import { createServer } from "../../server.js";

const mockDepartures = [
    { when: "2025-06-01T12:05:00+02:00", direction: "B", tripId: "2" },
    { when: "2025-06-01T12:00:00+02:00", direction: "A", tripId: "1" },
];

const departuresMock = mock(() =>
    Promise.resolve({ departures: mockDepartures }),
);
const locationsMock = mock(() => Promise.resolve([]));
const redisGetMock = mock((): Promise<string | null> => Promise.resolve(null));
const redisSetMock = mock(() => Promise.resolve("OK"));

const mockHafas = {
    departures: departuresMock,
    locations: locationsMock,
} as unknown as HafasClient;

const mockRedis = {
    get: redisGetMock,
    set: redisSetMock,
    status: "ready",
} as unknown as Redis;

const testConfig: Config = {
    profile: "bvg",
    port: 0,
    redisUrl: "redis://localhost:6379",
    userAgent: "test/1.0",
    locationsCacheTtl: 3600_000,
    requestTimeoutMs: 10_000,
    observability: {
        enabled: false,
        otlpProtocol: "http/protobuf",
        serviceName: "esptransit-server",
        hafasProfile: "bvg",
        deploymentEnvironment: "test",
        exportIntervalMs: 15_000,
        exportTimeoutMs: 10_000,
    },
};

let app: FastifyInstance;

beforeAll(async () => {
    app = await createServer(mockHafas, mockRedis, testConfig);
    await app.ready();
});

afterAll(async () => {
    await app.close();
});

describe("GET /departures", () => {
    test("returns 400 when stops param is missing", async () => {
        const res = await app.inject({ method: "GET", url: "/departures" });
        expect(res.statusCode).toBe(400);
    });

    test("returns 400 for invalid duration", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/departures?stops=123&duration=abc",
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("duration");
    });

    test("returns 400 for invalid when", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/departures?stops=123&when=not-a-date",
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("when");
    });

    test("returns departures sorted by time", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));
        departuresMock.mockImplementation(() =>
            Promise.resolve({ departures: mockDepartures }),
        );

        const res = await app.inject({
            method: "GET",
            url: "/departures?stops=900000100003",
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.departures).toBeArray();
        expect(body.departures.length).toBe(2);
        // Should be sorted: A (12:00) before B (12:05)
        expect(body.departures[0].direction).toBe("A");
        expect(body.departures[1].direction).toBe("B");
        expect(body.realtimeDataUpdatedAt).toBeNumber();
    });

    test("sets X-Cache MISS header on cache miss", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));

        const res = await app.inject({
            method: "GET",
            url: "/departures?stops=900000100003",
        });

        expect(res.headers["x-cache"]).toBe("MISS");
    });

    test("sets X-Cache HIT header on cache hit", async () => {
        redisGetMock.mockImplementation(() =>
            Promise.resolve(JSON.stringify(mockDepartures)),
        );

        const res = await app.inject({
            method: "GET",
            url: "/departures?stops=900000100003",
        });

        expect(res.headers["x-cache"]).toBe("HIT");
    });
});
