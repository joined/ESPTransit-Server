import { describe, expect, test } from "bun:test";
import { hashKey, tryRedis } from "../redis.js";

describe("hashKey", () => {
    test("returns a 32-character hex string", () => {
        const result = hashKey({ foo: "bar" });
        expect(result).toMatch(/^[0-9a-f]{32}$/);
    });

    test("is deterministic across calls", () => {
        const a = hashKey({ x: 1, y: [2, 3] });
        const b = hashKey({ x: 1, y: [2, 3] });
        expect(a).toBe(b);
    });

    test("differs for different inputs", () => {
        const a = hashKey({ a: 1 });
        const b = hashKey({ a: 2 });
        expect(a).not.toBe(b);
    });
});

describe("tryRedis", () => {
    test("returns the value on success", async () => {
        const result = await tryRedis(() => Promise.resolve("hello"));
        expect(result).toBe("hello");
    });

    test("returns null on error", async () => {
        const result = await tryRedis(() => Promise.reject(new Error("fail")));
        expect(result).toBeNull();
    });
});
