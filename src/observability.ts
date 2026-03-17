import type { Span } from "@opentelemetry/api";
import {
    propagation,
    ROOT_CONTEXT,
    SpanKind,
    SpanStatusCode,
    trace,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_NAMESPACE,
    ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ObservabilityConfig } from "./config.js";

const SERVICE_VERSION = "1.0.0";
const tracer = trace.getTracer("esptransit-server.http", SERVICE_VERSION);
const otelLogger = logs.getLogger("esptransit-server.logs", SERVICE_VERSION);

type LogAttributes = Record<string, string | number | boolean>;

interface CounterLike {
    add: (value: number, attributes?: Record<string, string>) => void;
}

interface HistogramLike {
    record: (value: number, attributes?: Record<string, string>) => void;
}

const noopCounter: CounterLike = {
    add: () => {},
};

const noopHistogram: HistogramLike = {
    record: () => {},
};

const httpRequestsTotal: CounterLike = noopCounter;
const httpRequestDurationMs: HistogramLike = noopHistogram;
const cacheLookupsTotal: CounterLike = noopCounter;

const requestStarts = new WeakMap<FastifyRequest, bigint>();
const requestSpans = new WeakMap<FastifyRequest, Span>();

type CacheOutcome = "hit" | "miss";
type CacheRoute = "departures" | "locations";

export interface ObservabilityHandle {
    enabled: boolean;
    shutdown: () => Promise<void>;
}

interface EmitLogInput {
    severityNumber: SeverityNumber;
    severityText: "INFO" | "WARN" | "ERROR";
    body: string;
    attributes?: LogAttributes;
}

function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

function emitStructuredLog(input: EmitLogInput): void {
    otelLogger.emit({
        severityNumber: input.severityNumber,
        severityText: input.severityText,
        body: input.body,
        attributes: input.attributes,
    });
}

export function logInfo(body: string, attributes?: LogAttributes): void {
    console.log(body);
    emitStructuredLog({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body,
        attributes,
    });
}

export function logWarn(body: string, attributes?: LogAttributes): void {
    console.warn(body);
    emitStructuredLog({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body,
        attributes,
    });
}

export function logError(
    body: string,
    error?: unknown,
    attributes?: LogAttributes,
): void {
    const logAttributes: LogAttributes = { ...(attributes ?? {}) };
    if (error instanceof Error) {
        logAttributes["error.type"] = error.name;
        logAttributes["error.message"] = error.message;
        console.error(body, error.message);
    } else if (error !== undefined) {
        logAttributes["error.message"] = String(error);
        console.error(body, error);
    } else {
        console.error(body);
    }

    emitStructuredLog({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body,
        attributes: logAttributes,
    });
}

function stripQuery(rawUrl: string): string {
    const [path] = rawUrl.split("?");
    return path || "/";
}

function getRequestPath(request: FastifyRequest): string {
    return stripQuery(request.raw.url ?? request.url);
}

function getRouteLabel(request: FastifyRequest): string {
    return request.routeOptions?.url ?? getRequestPath(request);
}

function toMilliseconds(start: bigint): number {
    return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function buildSignalUrl(endpoint: string, signal: "traces" | "logs"): string {
    const normalized = endpoint.endsWith("/")
        ? endpoint.slice(0, -1)
        : endpoint;
    const withoutSignalPath = normalized
        .replace(/\/v1\/traces$/, "")
        .replace(/\/v1\/logs$/, "");
    return `${withoutSignalPath}/v1/${signal}`;
}

function parseOtlpHeaders(raw?: string): Record<string, string> {
    if (!raw) return {};

    const headers: Record<string, string> = {};
    for (const entry of raw.split(",")) {
        const part = entry.trim();
        if (!part) continue;

        const separatorIndex = part.indexOf("=");
        if (separatorIndex <= 0) continue;

        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;

        try {
            headers[key] = decodeURIComponent(value);
        } catch {
            headers[key] = value;
        }
    }

    return headers;
}

export function startObservability(
    config: ObservabilityConfig,
): ObservabilityHandle {
    const endpoint = config.endpoint;
    if (!config.enabled || !endpoint) {
        if ((process.env.OBSERVABILITY_ENABLED ?? "true") === "false") {
            logInfo("[otel] disabled via OBSERVABILITY_ENABLED=false");
        } else if (!endpoint) {
            logInfo("[otel] disabled (missing OTLP_ENDPOINT)");
        } else {
            logInfo("[otel] disabled (missing OTEL_EXPORTER_OTLP_HEADERS)");
        }

        return {
            enabled: false,
            shutdown: async () => {},
        };
    }

    if (config.otlpProtocol !== "http/protobuf") {
        logWarn(
            `[otel] OTEL_EXPORTER_OTLP_PROTOCOL=${config.otlpProtocol} is not supported by this setup; using http/protobuf`,
        );
    }

    const headers = parseOtlpHeaders(config.otlpHeaders);

    const traceExporter = new OTLPTraceExporter({
        url: buildSignalUrl(endpoint, "traces"),
        headers,
        timeoutMillis: config.exportTimeoutMs,
    });
    const logExporter = new OTLPLogExporter({
        url: buildSignalUrl(endpoint, "logs"),
        headers,
        timeoutMillis: config.exportTimeoutMs,
    });
    const logRecordProcessor = new BatchLogRecordProcessor(logExporter);

    const resourceAttributes: Record<string, string> = {
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
        "deployment.environment": config.deploymentEnvironment,
        "hafas.profile": config.hafasProfile,
    };
    if (config.serviceNamespace) {
        resourceAttributes[ATTR_SERVICE_NAMESPACE] = config.serviceNamespace;
    }

    const sdk = new NodeSDK({
        resource: resourceFromAttributes(resourceAttributes),
        traceExporter,
        logRecordProcessors: [logRecordProcessor],
    });

    try {
        sdk.start();
        logInfo(`[otel] enabled endpoint=${endpoint} logs=enabled`);
        return {
            enabled: true,
            shutdown: async () => {
                try {
                    await sdk.shutdown();
                } catch (err) {
                    logError("[otel] shutdown error", toErrorMessage(err));
                }
            },
        };
    } catch (err) {
        logError("[otel] startup error", toErrorMessage(err));
        return {
            enabled: false,
            shutdown: async () => {},
        };
    }
}

export function registerHttpObservabilityHooks(app: FastifyInstance): void {
    app.addHook("onRequest", async (request) => {
        requestStarts.set(request, process.hrtime.bigint());

        const path = getRequestPath(request);
        const parentContext = propagation.extract(
            ROOT_CONTEXT,
            request.headers as Record<string, unknown>,
        );
        const span = tracer.startSpan(
            `${request.method} ${path}`,
            {
                kind: SpanKind.SERVER,
                attributes: {
                    "http.request.method": request.method,
                    "url.path": path,
                    "server.address": request.hostname,
                },
            },
            parentContext,
        );
        requestSpans.set(request, span);
    });

    app.addHook("onError", async (request, _reply, error) => {
        const span = requestSpans.get(request);
        if (!span) return;
        span.recordException(error);
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
        });

        emitStructuredLog({
            severityNumber: SeverityNumber.ERROR,
            severityText: "ERROR",
            body: error.message,
            attributes: {
                "http.request.method": request.method,
                "url.path": getRequestPath(request),
                "http.route": getRouteLabel(request),
                "error.type": error.name,
                "http.request.id": request.id,
            },
        });
    });

    app.addHook("onResponse", async (request, reply) => {
        const route = getRouteLabel(request);
        const statusCode = reply.statusCode;
        const labels = {
            method: request.method,
            route,
            status_code: String(statusCode),
            status_class: `${Math.floor(statusCode / 100)}xx`,
        };

        httpRequestsTotal.add(1, labels);

        const startedAt = requestStarts.get(request);
        let durationMs: number | undefined;
        if (startedAt) {
            durationMs = toMilliseconds(startedAt);
            httpRequestDurationMs.record(durationMs, labels);
            requestStarts.delete(request);
        }

        const logAttributes: Record<string, string | number> = {
            "http.request.method": request.method,
            "http.route": route,
            "http.response.status_code": statusCode,
            "http.request.id": request.id,
        };
        if (durationMs !== undefined) {
            logAttributes["http.server.duration_ms"] = durationMs;
        }
        const cacheHeader = reply.getHeader("X-Cache");
        if (typeof cacheHeader === "string") {
            logAttributes["cache.result"] = cacheHeader;
        }

        let severityNumber = SeverityNumber.INFO;
        let severityText: EmitLogInput["severityText"] = "INFO";
        if (statusCode >= 500) {
            severityNumber = SeverityNumber.ERROR;
            severityText = "ERROR";
        } else if (statusCode >= 400) {
            severityNumber = SeverityNumber.WARN;
            severityText = "WARN";
        }

        emitStructuredLog({
            severityNumber,
            severityText,
            body: "http request completed",
            attributes: logAttributes,
        });

        const span = requestSpans.get(request);
        if (!span) return;

        span.setAttribute("http.route", route);
        span.setAttribute("http.response.status_code", statusCode);
        if (statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
        requestSpans.delete(request);
    });
}

export function recordCacheLookup(
    route: CacheRoute,
    outcome: CacheOutcome,
): void {
    cacheLookupsTotal.add(1, { route, outcome });
}
