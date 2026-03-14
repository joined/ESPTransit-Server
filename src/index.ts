import { createRedisClient } from "./cache/redis.js";
import { loadConfig } from "./config.js";
import { createHafasClient } from "./hafas.js";
import { logError, logInfo, startObservability } from "./observability.js";
import { createServer } from "./server.js";

let shutdownObservability: (() => Promise<void>) | null = null;

async function main() {
    const config = loadConfig();
    const observability = startObservability(config.observability);
    shutdownObservability = observability.shutdown;

    logInfo(
        `[init] profile=${config.profile} port=${config.port} observability=${observability.enabled ? "enabled" : "disabled"}`,
    );

    const redis = createRedisClient(config.redisUrl);
    // Best-effort connect; errors are handled gracefully in tryRedis
    await redis.connect().catch((err: Error) => {
        logError("[redis] initial connect failed (will retry)", err);
    });

    const hafas = await createHafasClient(config.profile, config.userAgent);

    const app = await createServer(hafas, redis, config);

    const shutdown = async (signal: string) => {
        logInfo(`[shutdown] signal=${signal}`);
        await app.close().catch((err: Error) => {
            logError("[shutdown] app close error", err);
        });
        await redis.quit().catch((err: Error) => {
            logError("[shutdown] redis quit error", err);
        });
        await observability.shutdown();
        process.exit(0);
    };

    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });

    await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch(async (err) => {
    logError("[fatal]", err);
    if (shutdownObservability) {
        await shutdownObservability();
    }
    process.exit(1);
});
