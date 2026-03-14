import { createHash } from "node:crypto";
import Redis from "ioredis";
import { logError } from "../observability.js";

export function createRedisClient(redisUrl: string): Redis {
    const client = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    client.on("error", (err) => {
        // Log but don't crash — graceful degradation
        logError("[redis] connection error", err);
    });

    return client;
}

export function hashKey(data: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(data), "utf8")
        .digest("hex")
        .slice(0, 32);
}

/** Try a Redis operation; return null on any error (graceful degradation). */
export async function tryRedis<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn();
    } catch (err) {
        logError("[redis] operation error", err);
        return null;
    }
}
