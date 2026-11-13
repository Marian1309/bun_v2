import type { Server } from "bun";

import { env } from "@/config/env";
import { logger } from "@/core/logger";
import { to } from "@/core/try-catch";
import { stopRedis } from "@/pubsub/redis";
import type { ConnectionData } from "@/ws/connections";

import { markDraining } from "./drain";

/** Time the balancer gets to notice the failing readiness probe before sockets close; skipped outside production. */
const DRAIN_MS = 5000;

/** Hard deadline for the whole shutdown, drain included. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** Graceful stop on SIGTERM / SIGINT: fail readiness, wait for the balancer, close sockets with 1001, exit. */
export const installShutdown = (server: Server<ConnectionData>) => {
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    logger.info("Shutdown started", { signal, open_sockets: server.pendingWebSockets });
    markDraining();

    // Hard stop: a socket that never finishes its close handshake must not hold the process past the deadline.
    setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Readiness fails first: the balancer needs time to stop routing before the sockets go away.
    if (env.app.NODE_ENV === "production") await Bun.sleep(DRAIN_MS);

    const { error } = await to(() => server.stop(true));

    if (error) logger.error("Server stop failed", { err: error });

    stopRedis();
    logger.info("Shutdown complete");
    process.exit(error ? 1 : 0);
  };

  for (const signal of SIGNALS) process.on(signal, () => void shutdown(signal));
};
