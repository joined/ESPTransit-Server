import { describe, expect, mock, test } from "bun:test";
import type { Alternative } from "hafas-client";
import {
    buildKey,
    getTTL,
    readDeparturesCache,
    whenBucket,
    writeDeparturesCache,
} from "../departures.js";

describe("whenBucket", () => {
    test("rounds down to 30-second buckets", () => {
        // 60_000 ms = 60s → floor(60000/30000)*30 = 60
        expect(whenBucket(60_000)).toBe(60);
    });

    test("rounds 45s down to 30s bucket", () => {
        // 45_000 ms → floor(45000/30000)*30 = 30
        expect(whenBucket(45_000)).toBe(30);
    });

    test("exact bucket boundary stays the same", () => {
        // 90_000 ms → floor(90000/30000)*30 = 90
        expect(whenBucket(90_000)).toBe(90);
    });

    test("returns 0 for time < 30s", () => {
        expect(whenBucket(15_000)).toBe(0);
    });
});

describe("getTTL", () => {
    test("returns 20_000 for empty departures", () => {
        expect(getTTL([])).toBe(20_000);
    });

    test("returns 20_000 for departures in the past", () => {
        const pastDep = {
            when: new Date(Date.now() - 60_000).toISOString(),
        } as Alternative;
        expect(getTTL([pastDep])).toBe(20_000);
    });

    test("returns 2*sqrt(secsAway)*1000 for future departure", () => {
        const secsAway = 900; // 15 minutes
        const futureWhen = new Date(Date.now() + secsAway * 1000).toISOString();
        const result = getTTL([{ when: futureWhen } as Alternative]);
        const expected = Math.round(2 * Math.sqrt(secsAway) * 1000);
        // Allow small timing tolerance (±100ms) since Date.now() shifts between lines
        expect(Math.abs(result - expected)).toBeLessThan(100);
    });

    test("clamps sqrt to minimum of 5", () => {
        // 1 second away → sqrt(1)=1, but max(5,1)=5 → 2*5*1000 = 10000
        const futureWhen = new Date(Date.now() + 1000).toISOString();
        const result = getTTL([{ when: futureWhen } as Alternative]);
        expect(result).toBe(10_000);
    });

    test("returns 20_000 when when is null", () => {
        expect(getTTL([{ when: null } as unknown as Alternative])).toBe(20_000);
    });
});

describe("buildKey", () => {
    test("produces correct format", () => {
        expect(buildKey("bvg", "900000100003", 60, 10, "abc123")).toBe(
            "dep:bvg:900000100003:60:10:abc123",
        );
    });
});

describe("readDeparturesCache", () => {
    test("returns parsed data on cache hit", async () => {
        const departures = [
            { when: "2025-01-01T12:00:00Z", direction: "Test" },
        ];
        const fakeRedis = {
            get: mock(() => Promise.resolve(JSON.stringify(departures))),
        } as any;

        const result = await readDeparturesCache(
            fakeRedis,
            "bvg",
            "stop1",
            60_000,
            10,
            {},
        );
        expect(result).toEqual(departures as any);
        expect(fakeRedis.get).toHaveBeenCalledTimes(1);
    });

    test("returns null on cache miss", async () => {
        const fakeRedis = {
            get: mock(() => Promise.resolve(null)),
        } as any;

        const result = await readDeparturesCache(
            fakeRedis,
            "bvg",
            "stop1",
            60_000,
            10,
            {},
        );
        expect(result).toBeNull();
    });

    test("returns null on Redis error", async () => {
        const fakeRedis = {
            get: mock(() => Promise.reject(new Error("connection refused"))),
        } as any;

        const result = await readDeparturesCache(
            fakeRedis,
            "bvg",
            "stop1",
            60_000,
            10,
            {},
        );
        expect(result).toBeNull();
    });
});

describe("writeDeparturesCache", () => {
    test("writes with PX TTL", async () => {
        const fakeRedis = {
            set: mock(() => Promise.resolve("OK")),
        } as any;

        const departures = [
            { when: new Date(Date.now() + 900_000).toISOString() },
        ] as Alternative[];
        await writeDeparturesCache(
            fakeRedis,
            "bvg",
            "stop1",
            60_000,
            10,
            {},
            departures,
        );

        expect(fakeRedis.set).toHaveBeenCalledTimes(1);
        const args = fakeRedis.set.mock.calls[0];
        expect(args[0]).toMatch(/^dep:bvg:stop1:/);
        expect(args[2]).toBe("PX");
        expect(typeof args[3]).toBe("number");
        expect(args[3]).toBeGreaterThan(0);
    });

    test("gracefully handles Redis error", async () => {
        const fakeRedis = {
            set: mock(() => Promise.reject(new Error("connection refused"))),
        } as any;

        // Should not throw
        await writeDeparturesCache(
            fakeRedis,
            "bvg",
            "stop1",
            60_000,
            10,
            {},
            [],
        );
    });
});
