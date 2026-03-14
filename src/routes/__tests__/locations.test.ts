import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { HafasClient } from "hafas-client";
import type Redis from "ioredis";
import type { Config } from "../../config.js";
import { createServer } from "../../server.js";

const mockLocations = [
    {
        type: "stop",
        id: "900000100003",
        name: "Alexanderplatz",
        location: { latitude: 52.52, longitude: 13.41 },
    },
];

const departuresMock = mock(() => Promise.resolve({ departures: [] }));
const locationsMock = mock((_query: string, _opts?: Record<string, unknown>) =>
    Promise.resolve(mockLocations),
);
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

describe("GET /locations", () => {
    test("returns 400 when query param is missing", async () => {
        const res = await app.inject({ method: "GET", url: "/locations" });
        expect(res.statusCode).toBe(400);
    });

    test("returns 400 when query is empty", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/locations?query=%20",
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("empty");
    });

    test("returns locations on success", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));
        locationsMock.mockImplementation(() => Promise.resolve(mockLocations));

        const res = await app.inject({
            method: "GET",
            url: "/locations?query=Alexanderplatz",
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toBeArray();
        expect(body[0].name).toBe("Alexanderplatz");
    });

    test("passes linesOfStops as false by default", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));

        const res = await app.inject({
            method: "GET",
            url: "/locations?query=Alexanderplatz",
        });

        expect(res.statusCode).toBe(200);
        const lastCall = locationsMock.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe("Alexanderplatz");
        expect(lastCall?.[1]).toMatchObject({
            results: 5,
            stops: true,
            poi: true,
            addresses: true,
            linesOfStops: false,
        });
    });

    test("passes linesOfStops=true to hafas-client when requested", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));

        const res = await app.inject({
            method: "GET",
            url: "/locations?query=Alexanderplatz&linesOfStops=true",
        });

        expect(res.statusCode).toBe(200);
        const lastCall = locationsMock.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe("Alexanderplatz");
        expect(lastCall?.[1]).toMatchObject({
            linesOfStops: true,
        });
    });

    test("sets X-Cache MISS on cache miss", async () => {
        redisGetMock.mockImplementation(() => Promise.resolve(null));

        const res = await app.inject({
            method: "GET",
            url: "/locations?query=Alexanderplatz",
        });

        expect(res.headers["x-cache"]).toBe("MISS");
    });

    test("sets X-Cache HIT on cache hit", async () => {
        redisGetMock.mockImplementation(() =>
            Promise.resolve(JSON.stringify(mockLocations)),
        );

        const res = await app.inject({
            method: "GET",
            url: "/locations?query=Alexanderplatz",
        });

        expect(res.headers["x-cache"]).toBe("HIT");
    });
});
