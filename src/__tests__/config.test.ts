import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Reset to clean state
        delete process.env.HAFAS_PROFILE;
        delete process.env.PORT;
        delete process.env.REDIS_URL;
        delete process.env.USER_AGENT;
        delete process.env.OBSERVABILITY_ENABLED;
        delete process.env.OTLP_ENDPOINT;
        delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
        delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
        delete process.env.OTEL_SERVICE_NAME;
        delete process.env.OTEL_SERVICE_NAMESPACE;
        delete process.env.OTEL_DEPLOYMENT_ENVIRONMENT;
        delete process.env.OTEL_EXPORT_INTERVAL_MS;
        delete process.env.OTEL_EXPORT_TIMEOUT_MS;
    });

    afterEach(() => {
        // Restore original env
        Object.assign(process.env, originalEnv);
    });

    test("throws when HAFAS_PROFILE is missing", () => {
        expect(() => loadConfig()).toThrow(
            "Missing required env var: HAFAS_PROFILE",
        );
    });

    test("throws for an invalid profile", () => {
        process.env.HAFAS_PROFILE = "nonexistent";
        expect(() => loadConfig()).toThrow("Unknown HAFAS_PROFILE");
    });

    test("returns config for a valid profile", () => {
        process.env.HAFAS_PROFILE = "bvg";
        const config = loadConfig();
        expect(config.profile).toBe("bvg");
        expect(config.port).toBe(3000);
        expect(config.redisUrl).toBe("redis://localhost:6379");
        expect(config.observability.enabled).toBeFalse();
        expect(config.observability.hafasProfile).toBe("bvg");
        expect(config.observability.otlpProtocol).toBe("http/protobuf");
    });

    test("respects custom PORT", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.PORT = "8080";
        expect(loadConfig().port).toBe(8080);
    });

    test("respects custom REDIS_URL", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.REDIS_URL = "redis://custom:6380";
        expect(loadConfig().redisUrl).toBe("redis://custom:6380");
    });

    test("is case-insensitive for profile", () => {
        process.env.HAFAS_PROFILE = "BVG";
        const config = loadConfig();
        expect(config.profile).toBe("bvg");
        expect(config.observability.hafasProfile).toBe("bvg");
    });

    test("enables observability when OTLP config is complete", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.OTLP_ENDPOINT = "https://otlp.example.com/otlp";
        process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20abc123";

        const config = loadConfig();
        expect(config.observability.enabled).toBeTrue();
        expect(config.observability.serviceName).toBe("esptransit-server");
        expect(config.observability.exportIntervalMs).toBe(15_000);
    });

    test("disables observability when explicitly turned off", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.OTLP_ENDPOINT = "https://otlp.example.com/otlp";
        process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20abc123";
        process.env.OBSERVABILITY_ENABLED = "false";

        expect(loadConfig().observability.enabled).toBeFalse();
    });

    test("enables observability when OTLP headers are set", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.OTLP_ENDPOINT =
            "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp";
        process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20abc123";

        const observability = loadConfig().observability;
        expect(observability.enabled).toBeTrue();
        expect(observability.otlpHeaders).toBe("Authorization=Basic%20abc123");
    });

    test("respects OTEL service metadata env vars", () => {
        process.env.HAFAS_PROFILE = "bvg";
        process.env.OTLP_ENDPOINT =
            "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp";
        process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20abc123";
        process.env.OTEL_SERVICE_NAME = "custom-esptransit";
        process.env.OTEL_SERVICE_NAMESPACE = "transit";
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT = "production";
        process.env.OTEL_EXPORT_INTERVAL_MS = "5000";
        process.env.OTEL_EXPORT_TIMEOUT_MS = "7000";
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";

        const observability = loadConfig().observability;
        expect(observability.serviceName).toBe("custom-esptransit");
        expect(observability.serviceNamespace).toBe("transit");
        expect(observability.deploymentEnvironment).toBe("production");
        expect(observability.exportIntervalMs).toBe(5000);
        expect(observability.exportTimeoutMs).toBe(7000);
        expect(observability.otlpProtocol).toBe("http/protobuf");
    });
});
