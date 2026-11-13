import type { Server } from "bun";

import { env, validateEnv } from "@/config/env";
import { logger } from "@/core/logger";
import { handleHealth, handleReady } from "@/http/health";
import { handlePublish } from "@/http/publish";
import { attachServer, deliverRemote } from "@/pubsub/broker";
import { startRedis } from "@/pubsub/redis";
import type { ConnectionData } from "@/ws/connections";
import { closeExpiredSockets, websocketHandlers } from "@/ws/handlers";

import { handleUpgrade } from "./upgrade";

/** Largest client frame and largest `POST /publish` body (64 KB): ample for JSON events, small enough to bound memory. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const NOT_FOUND = 404;
const INTERNAL_SERVER_ERROR = 500;

/** Upper bound on how long an idle socket outlives its token. */
const EXPIRY_SWEEP_MS = 15_000;

/** Validates the whole env first, so a bad or missing key fails the boot instead of the first request. */
export const startServer = (): Server<ConnectionData> => {
  validateEnv();

  const { PORT, NODE_ENV } = env.app;

  const server = Bun.serve({
    port: PORT,
    // Off in every environment: Bun's development error page would leak stack traces.
    development: false,
    maxRequestBodySize: MAX_PAYLOAD_BYTES,
    routes: {
      "/healthz": { GET: handleHealth },
      "/readyz": { GET: handleReady },
      "/publish": { POST: handlePublish },
      "/ws": { GET: handleUpgrade }
    },
    fetch: () => Response.json({ error: "not_found" }, { status: NOT_FOUND }),
    error: (error) => {
      logger.error("HTTP handler threw", { err: error });

      return Response.json({ error: "internal_error" }, { status: INTERNAL_SERVER_ERROR });
    },
    websocket: {
      // Cast: Bun's documented way to type `ws.data`; the value itself is never read.
      data: {} as ConnectionData,
      ...websocketHandlers,
      maxPayloadLength: MAX_PAYLOAD_BYTES,
      idleTimeout: 120,
      backpressureLimit: 1024 * 1024,
      // A subscriber that cannot keep up is dropped rather than buffered without bound.
      closeOnBackpressureLimit: true
    }
  });

  attachServer(server);
  startRedis(deliverRemote);
  setInterval(closeExpiredSockets, EXPIRY_SWEEP_MS).unref();

  logger.info("Server listening", {
    port: server.port,
    node_env: NODE_ENV,
    redis: env.redis.REDIS_URL !== undefined
  });

  return server;
};
