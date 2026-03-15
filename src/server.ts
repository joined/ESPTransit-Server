import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import scalarReference from "@scalar/fastify-api-reference";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import Fastify from "fastify";
import type { HafasClient } from "hafas-client";
import type Redis from "ioredis";
import type { Config } from "./config.js";
import { registerHttpObservabilityHooks } from "./observability.js";
import { registerDeparturesRoute } from "./routes/departures.js";
import { registerLocationsRoute } from "./routes/locations.js";

export async function createServer(
    hafas: HafasClient,
    redis: Redis,
    config: Config,
) {
    const app = Fastify({ logger: true });
    registerHttpObservabilityHooks(app);

    await app.register(swagger, {
        openapi: {
            info: {
                title: "ESPTransit Server",
                description:
                    "HAFAS proxy server with Redis caching for public transit departures and locations.",
                version: "1.0.0",
            },
            servers: [{ url: "/" }],
            tags: [
                {
                    name: "departures",
                    description: "Real-time departure information",
                },
                { name: "locations", description: "Location/stop search" },
            ],
        },
    });

    await app.register(scalarReference, {
        routePrefix: "/docs",
    });

    await app.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
    });
    await app.register(compress);

    registerDeparturesRoute(app, hafas, redis, config);
    registerLocationsRoute(app, hafas, redis, config);

    app.get(
        "/",
        {
            schema: { hide: true },
        },
        async (_request, reply) => {
            reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ESPTransit Server</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 1rem; color: #333; }
        h1 { margin-bottom: 0.25rem; }
        a { color: #0969da; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
        ul { padding-left: 1.25rem; }
        li { margin: 0.4rem 0; }
    </style>
</head>
<body>
    <h1>ESPTransit Server</h1>
    <p>HAFAS proxy with Redis caching for public transit data.</p>
    <p>Profile: <code>${config.profile}</code> · Rate limit: 100 req/min</p>
    <ul>
        <li><a href="/docs">API Documentation</a></li>
        <li><a href="https://github.com/joined/ESPTransit-Server">GitHub</a></li>
    </ul>
</body>
</html>`);
        },
    );

    app.get(
        "/llms.txt",
        { schema: { hide: true } },
        async (_request, reply) => {
            const spec = app.swagger();
            const markdown = await createMarkdownFromOpenApi(
                JSON.parse(JSON.stringify(spec)),
            );
            return reply.type("text/plain; charset=utf-8").send(markdown);
        },
    );

    app.get(
        "/health",
        {
            schema: {
                hide: true,
                tags: ["health"],
                response: {
                    200: {
                        type: "object",
                        properties: {
                            status: { type: "string", enum: ["ok"] },
                            profile: { type: "string" },
                        },
                    },
                },
            },
        },
        async () => ({ status: "ok", profile: config.profile }),
    );

    return app;
}
