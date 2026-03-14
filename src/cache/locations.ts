import type { Location, Station, Stop } from "hafas-client";
import type Redis from "ioredis";
import { hashKey, tryRedis } from "./redis.js";

export type LocationResult = readonly (Station | Stop | Location)[];

function buildKey(profile: string, inputHash: string): string {
    return `loc:${profile}:${inputHash}`;
}

export async function readLocationsCache(
    redis: Redis,
    profile: string,
    query: string,
    opts: unknown,
): Promise<LocationResult | null> {
    const key = buildKey(profile, hashKey([query, opts]));
    const raw = await tryRedis(() => redis.get(key));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as LocationResult;
    } catch {
        return null;
    }
}

export async function writeLocationsCache(
    redis: Redis,
    profile: string,
    query: string,
    opts: unknown,
    result: LocationResult,
    ttlMs: number,
): Promise<void> {
    const key = buildKey(profile, hashKey([query, opts]));
    await tryRedis(() => redis.set(key, JSON.stringify(result), "PX", ttlMs));
}
