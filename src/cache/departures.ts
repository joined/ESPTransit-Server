import type { Alternative } from "hafas-client";
import type Redis from "ioredis";
import { hashKey, tryRedis } from "./redis.js";

/** Round `when` (ms epoch) to nearest 30-second bucket (returns seconds). */
export function whenBucket(whenMs: number): number {
    return Math.floor(whenMs / 30_000) * 30;
}

/** Dynamic TTL based on how soon the earliest departure is. */
export function getTTL(departures: readonly Alternative[]): number {
    const earliest = departures[0]?.when;
    if (!earliest) return 20_000;
    const secsAway = (new Date(earliest).getTime() - Date.now()) / 1000;
    if (secsAway <= 0) return 20_000;
    return Math.round(2 * Math.max(5, Math.sqrt(secsAway)) * 1000);
}

export function buildKey(
    profile: string,
    stopId: string,
    bucket: number,
    duration: number,
    optsHash: string,
): string {
    return `dep:${profile}:${stopId}:${bucket}:${duration}:${optsHash}`;
}

export async function readDeparturesCache(
    redis: Redis,
    profile: string,
    stopId: string,
    whenMs: number,
    duration: number,
    extraOpts: unknown,
): Promise<readonly Alternative[] | null> {
    const key = buildKey(
        profile,
        stopId,
        whenBucket(whenMs),
        duration,
        hashKey(extraOpts),
    );
    const raw = await tryRedis(() => redis.get(key));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as readonly Alternative[];
    } catch {
        return null;
    }
}

export async function writeDeparturesCache(
    redis: Redis,
    profile: string,
    stopId: string,
    whenMs: number,
    duration: number,
    extraOpts: unknown,
    departures: readonly Alternative[],
): Promise<void> {
    const key = buildKey(
        profile,
        stopId,
        whenBucket(whenMs),
        duration,
        hashKey(extraOpts),
    );
    const ttl = getTTL(departures);
    await tryRedis(() => redis.set(key, JSON.stringify(departures), "PX", ttl));
}
