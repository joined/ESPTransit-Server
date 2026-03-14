const VALID_PROFILES = [
    "avv",
    "bart",
    "bls",
    "bvg",
    "cfl",
    "cmta",
    "dart",
    "db",
    "db-busradar-nrw",
    "insa",
    "invg",
    "irish-rail",
    "ivb",
    "kvb",
    "mobil-nrw",
    "mobiliteit-lu",
    "nahsh",
    "nvv",
    "oebb",
    "ooevv",
    "pkp",
    "rejseplanen",
    "rmv",
    "rsag",
    "saarfahrplan",
    "salzburg",
    "sbahn-muenchen",
    "sncb",
    "stv",
    "svv",
    "tpg",
    "vbb",
    "vbn",
    "vkg",
    "vmt",
    "vor",
    "vos",
    "vrn",
    "vsn",
    "vvt",
    "vvv",
    "zvv",
] as const;

export type HafasProfile = (typeof VALID_PROFILES)[number];

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required env var: ${name}`);
    return val;
}

function getProfile(): HafasProfile {
    const profile = requireEnv("HAFAS_PROFILE").toLowerCase();
    if (!VALID_PROFILES.includes(profile as HafasProfile)) {
        throw new Error(
            `Unknown HAFAS_PROFILE "${profile}". Valid: ${VALID_PROFILES.join(", ")}`,
        );
    }
    return profile as HafasProfile;
}

function optionalEnv(name: string): string | undefined {
    const val = process.env[name]?.trim();
    if (!val) return undefined;
    return val;
}

function parseIntEnv(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return defaultValue;
    return parsed;
}

function parseObservabilityConfig(
    hafasProfile: HafasProfile,
): ObservabilityConfig {
    const endpoint = optionalEnv("OTLP_ENDPOINT");
    const otlpHeaders = optionalEnv("OTEL_EXPORTER_OTLP_HEADERS");

    return {
        enabled:
            (process.env.OBSERVABILITY_ENABLED ?? "true") !== "false" &&
            Boolean(endpoint) &&
            Boolean(otlpHeaders),
        endpoint,
        otlpProtocol: (
            process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf"
        )
            .trim()
            .toLowerCase(),
        otlpHeaders,
        serviceName: process.env.OTEL_SERVICE_NAME ?? "esptransit-server",
        serviceNamespace: optionalEnv("OTEL_SERVICE_NAMESPACE"),
        hafasProfile,
        deploymentEnvironment:
            process.env.OTEL_DEPLOYMENT_ENVIRONMENT ??
            process.env.NODE_ENV ??
            "development",
        exportIntervalMs: parseIntEnv("OTEL_EXPORT_INTERVAL_MS", 15_000),
        exportTimeoutMs: parseIntEnv("OTEL_EXPORT_TIMEOUT_MS", 10_000),
    };
}

export interface ObservabilityConfig {
    enabled: boolean;
    endpoint?: string;
    otlpProtocol: string;
    otlpHeaders?: string;
    serviceName: string;
    serviceNamespace?: string;
    hafasProfile: HafasProfile;
    deploymentEnvironment: string;
    exportIntervalMs: number;
    exportTimeoutMs: number;
}

export interface Config {
    profile: HafasProfile;
    port: number;
    redisUrl: string;
    userAgent: string;
    locationsCacheTtl: number;
    requestTimeoutMs: number;
    observability: ObservabilityConfig;
}

export function loadConfig(): Config {
    const profile = getProfile();

    return {
        profile,
        port: parseIntEnv("PORT", 3000),
        redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
        userAgent:
            process.env.USER_AGENT ??
            "esptransit-server/1.0 contact@example.com",
        locationsCacheTtl: parseIntEnv(
            "DEPARTURES_CACHE_TTL_LOCATIONS",
            3_600_000,
        ),
        requestTimeoutMs: parseIntEnv("REQUEST_TIMEOUT_MS", 10_000),
        observability: parseObservabilityConfig(profile),
    };
}
