import { isAllowed, isChannelName } from "@/auth/channel-acl";
import { logger } from "@/core/logger";
import { toSync } from "@/core/try-catch";
import { publish } from "@/pubsub/broker";

import type { Socket } from "./connections";
import { addSocket, listSockets, releaseSlot, removeSocket } from "./connections";
import type { ClientMessage, ErrorCode } from "./protocol";
import {
  ackFrame,
  CLOSE_CODES,
  clientMessageSchema,
  ERROR_CODES,
  errorFrame,
  pongFrame,
  welcomeFrame
} from "./protocol";
import { takeToken } from "./rate-limit";

/** Consecutive rate-limited frames before the socket is closed: a client ignoring `rate_limited` is abusive. */
const MAX_RATE_LIMIT_STRIKES = 20;

const MAX_SUBSCRIPTIONS_PER_CONNECTION = 100;

type SendInput = { ws: Socket; frame: string };

const send = ({ ws, frame }: SendInput) => {
  ws.send(frame);
};

type SendErrorInput = { ws: Socket; id?: string; code: ErrorCode; message: string };

const sendError = ({ ws, id, code, message }: SendErrorInput) => {
  send({ ws, frame: errorFrame({ id, code, message }) });
};

type SendAckInput = { ws: Socket; id: string | undefined };

const sendAck = ({ ws, id }: SendAckInput) => {
  if (id !== undefined) send({ ws, frame: ackFrame(id) });
};

type HandlerInput<T extends ClientMessage["type"]> = { ws: Socket; message: Extract<ClientMessage, { type: T }> };

const handleSubscribe = ({ ws, message }: HandlerInput<"subscribe">) => {
  const { channel, id } = message;

  if (!isAllowed({ patterns: ws.data.subscribe_patterns, channel }))
    return sendError({ ws, id, code: ERROR_CODES.forbidden, message: "Not allowed to subscribe to this channel" });

  if (!ws.isSubscribed(channel)) {
    if (ws.data.subscription_count >= MAX_SUBSCRIPTIONS_PER_CONNECTION)
      return sendError({ ws, id, code: ERROR_CODES.too_many_subscriptions, message: "Subscription limit reached" });

    ws.subscribe(channel);
    ws.data.subscription_count += 1;
  }

  sendAck({ ws, id });
};

const handleUnsubscribe = ({ ws, message }: HandlerInput<"unsubscribe">) => {
  if (ws.isSubscribed(message.channel)) {
    ws.unsubscribe(message.channel);
    ws.data.subscription_count -= 1;
  }

  sendAck({ ws, id: message.id });
};

const handlePublish = ({ ws, message }: HandlerInput<"publish">) => {
  const { channel, id, data } = message;

  if (!isAllowed({ patterns: ws.data.publish_patterns, channel }))
    return sendError({ ws, id, code: ERROR_CODES.forbidden, message: "Not allowed to publish to this channel" });

  publish({ channel, data, sender_id: ws.data.user_id });
  sendAck({ ws, id });
};

type DispatchInput = { ws: Socket; message: ClientMessage };

const dispatch = ({ ws, message }: DispatchInput) => {
  if ("channel" in message && !isChannelName(message.channel))
    return sendError({ ws, id: message.id, code: ERROR_CODES.invalid_channel, message: "Invalid channel name" });

  switch (message.type) {
    case "subscribe":
      return handleSubscribe({ ws, message });
    case "unsubscribe":
      return handleUnsubscribe({ ws, message });
    case "publish":
      return handlePublish({ ws, message });
    case "ping":
      return send({ ws, frame: pongFrame(message.id) });
  }
};

/** `false` when the frame must be ignored; closes the socket once the strikes run out. */
const passesRateLimit = (ws: Socket): boolean => {
  if (takeToken(ws.data.bucket)) {
    ws.data.rate_limit_strikes = 0;

    return true;
  }

  ws.data.rate_limit_strikes += 1;

  if (ws.data.rate_limit_strikes > MAX_RATE_LIMIT_STRIKES)
    ws.close(CLOSE_CODES.policy_violation, "Rate limit exceeded");
  else sendError({ ws, code: ERROR_CODES.rate_limited, message: "Too many messages, slow down" });

  return false;
};

const closeIfExpired = (ws: Socket): boolean => {
  if (Date.now() < ws.data.expires_at_ms) return false;

  ws.close(CLOSE_CODES.token_expired, "Token expired");

  return true;
};

const handleMessage = (ws: Socket, raw: string | Buffer) => {
  if (closeIfExpired(ws) || !passesRateLimit(ws)) return;

  if (typeof raw !== "string")
    return sendError({ ws, code: ERROR_CODES.invalid_message, message: "Binary frames are not supported" });

  const parsed = clientMessageSchema.check(toSync<unknown>(() => JSON.parse(raw)).data);

  if (parsed.ok) dispatch({ ws, message: parsed.value });
  else sendError({ ws, code: ERROR_CODES.invalid_message, message: "Malformed message" });
};

const handleOpen = (ws: Socket) => {
  addSocket(ws);
  logger.debug("Connection opened", { connection_id: ws.data.connection_id, user_id: ws.data.user_id });
  send({ ws, frame: welcomeFrame(ws.data) });
};

const handleClose = (ws: Socket, code: number) => {
  removeSocket(ws);
  releaseSlot(ws.data);
  logger.debug("Connection closed", { connection_id: ws.data.connection_id, code });
};

const handleError = (error: Error, ws: Socket) => {
  logger.error("WebSocket handler threw", { connection_id: ws.data.connection_id, err: error });
  ws.close(CLOSE_CODES.internal_error, "Internal error");
};

/** Server-wide handlers for `Bun.serve({ websocket })`; all synchronous, so a throw always reaches `error`. */
export const websocketHandlers = {
  open: handleOpen,
  message: handleMessage,
  close: handleClose,
  error: handleError
};

/** Idle sockets never hit the per-message check, so expiry also needs a sweep. */
export const closeExpiredSockets = () => {
  for (const ws of listSockets()) closeIfExpired(ws);
};
