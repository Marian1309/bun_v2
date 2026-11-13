import { RedisClient } from "bun";

import { env } from "@/config/env";
import { logger } from "@/core/logger";
import { to, toSync } from "@/core/try-catch";
import { object, string } from "@/core/validate";

/** Tags outgoing envelopes so an instance skips the copies of its own publishes. */
const INSTANCE_ID = crypto.randomUUID();

const FANOUT_CHANNEL = "ws:fanout";

const MIN_RETRY_MS = 250;
const MAX_RETRY_MS = 10_000;
const RETRY_GROWTH = 2;

// Reconnects are driven by `maintain()`; a queued publish would be delivered late, so fail fast instead.
const CLIENT_OPTIONS = { autoReconnect: false, enableOfflineQueue: false, connectionTimeout: 5000 };

const envelopeSchema = object({ origin: string(), channel: string(), frame: string() });

export type Delivery = { channel: string; frame: string };

type Role = "publisher" | "subscriber";

let publisher: RedisClient | undefined;
let subscriber: RedisClient | undefined;
let isStopped = false;

export const isRedisEnabled = (): boolean => env.redis.REDIS_URL !== undefined;

/** `true` when Redis is not configured: readiness only depends on it when fan-out is on. */
export const isRedisReady = (): boolean =>
  !isRedisEnabled() || (publisher?.connected === true && subscriber?.connected === true);

type MaintainInput = {
  role: Role;
  url: string;
  setup?: (client: RedisClient) => Promise<void>;
  onReady: (client: RedisClient | undefined) => void;
};

/** Keeps one connection alive until `stopRedis()`: reconnects with capped backoff and re-runs `setup` each time. */
const maintain = async ({ role, url, setup, onReady }: MaintainInput): Promise<void> => {
  let retryMs = MIN_RETRY_MS;

  while (!isStopped) {
    const client = new RedisClient(url, CLIENT_OPTIONS);
    const { error } = await to(async () => {
      await client.connect();
      await setup?.(client);
    });

    if (!error && client.connected) {
      logger.info("Redis connected", { role });
      onReady(client);

      // A fresh client per attempt: after a drop the subscription state of the old one is unknown.
      client.onclose = (closeError) => {
        onReady(undefined);

        if (isStopped) return;

        logger.warn("Redis connection lost", { role, err: closeError });
        void maintain({ role, url, setup, onReady });
      };

      return;
    }

    client.close();
    logger.warn("Redis connection failed, retrying", { role, retry_ms: retryMs, err: error });
    await Bun.sleep(retryMs);
    retryMs = Math.min(MAX_RETRY_MS, retryMs * RETRY_GROWTH);
  }
};

/** Returns at once and connects in the background; `isRedisReady()` reports the outcome. No-op without `REDIS_URL`. */
export const startRedis = (onDelivery: (delivery: Delivery) => void) => {
  const { REDIS_URL } = env.redis;

  if (REDIS_URL === undefined) return;

  const handleEnvelope = (raw: string) => {
    const parsed = envelopeSchema.check(toSync<unknown>(() => JSON.parse(raw)).data);

    if (!parsed.ok) {
      logger.warn("Redis envelope dropped: invalid shape");

      return;
    }

    if (parsed.value.origin === INSTANCE_ID) return;

    onDelivery({ channel: parsed.value.channel, frame: parsed.value.frame });
  };

  void maintain({
    role: "publisher",
    url: REDIS_URL,
    onReady: (client) => {
      publisher = client;
    }
  });

  void maintain({
    role: "subscriber",
    url: REDIS_URL,
    setup: async (client) => {
      await client.subscribe(FANOUT_CHANNEL, handleEnvelope);
    },
    onReady: (client) => {
      subscriber = client;
    }
  });
};

/** Best effort: a failure is logged and counted, never thrown, because local subscribers were already served. */
export const forwardToRedis = async ({ channel, frame }: Delivery): Promise<void> => {
  const client = publisher;
  const envelope = JSON.stringify({ origin: INSTANCE_ID, channel, frame });
  const { error } = await to(async () => {
    if (client === undefined) throw new Error("Redis publisher is not connected");

    await client.publish(FANOUT_CHANNEL, envelope);
  });

  if (!error) return;

  logger.error("Redis publish failed", { channel, err: error });
};

export const stopRedis = () => {
  isStopped = true;
  publisher?.close();
  subscriber?.close();
};
