import { isRedisReady } from "@/pubsub/redis";
import { isDraining } from "@/server/drain";

const SERVICE_UNAVAILABLE = 503;

/** Liveness: the event loop answers. Never depends on Redis, so an outage does not get the process restarted. */
export const handleHealth = (): Response => Response.json({ status: "ok" });

/** Readiness: fails while draining or while fan-out is down, so the balancer stops sending new connections. */
export const handleReady = (): Response => {
  if (isDraining()) return Response.json({ status: "draining" }, { status: SERVICE_UNAVAILABLE });
  if (!isRedisReady()) return Response.json({ status: "redis_unavailable" }, { status: SERVICE_UNAVAILABLE });

  return Response.json({ status: "ready" });
};
