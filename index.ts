import { logger } from "@/core/logger";
import { toSync } from "@/core/try-catch";
import { startServer } from "@/server/server";
import { installShutdown } from "@/server/shutdown";

// State is unknown after either event: log, exit non-zero and let the supervisor restart the process.
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { err: error });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { err: reason });
  process.exit(1);
});

const { data: server, error: startError } = toSync(() => startServer());

if (startError) {
  logger.error("Server failed to start", { err: startError });
  process.exit(1);
}

installShutdown(server);
