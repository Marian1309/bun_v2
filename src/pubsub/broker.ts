import type { Server } from "bun";

import type { ConnectionData } from "@/ws/connections";
import { messageFrame } from "@/ws/protocol";

import type { Delivery } from "./redis";
import { forwardToRedis, isRedisEnabled } from "./redis";

let server: Server<ConnectionData> | undefined;

export const attachServer = (instance: Server<ConnectionData>) => {
  server = instance;
};

/** Hands a frame published on another instance to this instance's subscribers. */
export const deliverRemote = ({ channel, frame }: Delivery) => {
  server?.publish(channel, frame);
};

type PublishInput = { channel: string; data: unknown; sender_id: string | null };

/** Serves local subscribers synchronously (sender included), then forwards to other instances; returns the id. */
export const publish = ({ channel, data, sender_id }: PublishInput): string => {
  const message_id = Bun.randomUUIDv7();
  const frame = messageFrame({ channel, data, message_id, sender_id });

  server?.publish(channel, frame);

  // `forwardToRedis` never rejects, so the detached promise cannot become an unhandled rejection.
  if (isRedisEnabled()) void forwardToRedis({ channel, frame });

  return message_id;
};
