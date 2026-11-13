import type { Infer } from "@/core/validate";
import { literal, object, optional, string, union, unknown } from "@/core/validate";

export const CLOSE_CODES = {
  policy_violation: 1008,
  internal_error: 1011,
  token_expired: 4401
} as const;

export const ERROR_CODES = {
  invalid_message: "invalid_message",
  invalid_channel: "invalid_channel",
  forbidden: "forbidden",
  rate_limited: "rate_limited",
  too_many_subscriptions: "too_many_subscriptions"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const requestId = optional(string({ max: 64 }));

// Loose here, strict in the handler: a bad name then gets `invalid_channel` instead of a generic schema failure.
const channel = string();

export const clientMessageSchema = union([
  object({ type: literal("subscribe"), id: requestId, channel }),
  object({ type: literal("unsubscribe"), id: requestId, channel }),
  object({ type: literal("publish"), id: requestId, channel, data: unknown() }),
  object({ type: literal("ping"), id: requestId })
]);

export type ClientMessage = Infer<typeof clientMessageSchema>;

type WelcomeInput = { connection_id: string; user_id: string; expires_at_ms: number };

export const welcomeFrame = ({ connection_id, user_id, expires_at_ms }: WelcomeInput): string =>
  JSON.stringify({ type: "welcome", connection_id, user_id, expires_at: new Date(expires_at_ms).toISOString() });

export const ackFrame = (id: string): string => JSON.stringify({ type: "ack", id });

export const pongFrame = (id: string | undefined): string => JSON.stringify({ type: "pong", id });

type ErrorFrameInput = { id?: string; code: ErrorCode; message: string };

export const errorFrame = ({ id, code, message }: ErrorFrameInput): string =>
  JSON.stringify({ type: "error", id, code, message });

type MessageFrameInput = { channel: string; data: unknown; message_id: string; sender_id: string | null };

export const messageFrame = ({ channel: name, data, message_id, sender_id }: MessageFrameInput): string =>
  JSON.stringify({
    type: "message",
    channel: name,
    // `undefined` would drop the key; subscribers always get a `data` field.
    data: data ?? null,
    message_id,
    sender_id,
    sent_at: new Date().toISOString()
  });
