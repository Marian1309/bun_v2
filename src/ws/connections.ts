import type { ServerWebSocket } from "bun";

import type { ChannelPatterns } from "@/auth/channel-acl";

import type { Bucket } from "./rate-limit";

export type ConnectionData = {
  connection_id: string;
  user_id: string;
  ip: string;
  expires_at_ms: number;
  subscribe_patterns: ChannelPatterns;
  publish_patterns: ChannelPatterns;
  bucket: Bucket;
  /** Consecutive rate-limited frames; reset by the next accepted one. */
  rate_limit_strikes: number;
  subscription_count: number;
};

export type Socket = ServerWebSocket<ConnectionData>;

/** Per-instance caps: total bounds memory, per-IP and per-user stop one client from taking every slot. */
const MAX_CONNECTIONS = 10_000;
const MAX_CONNECTIONS_PER_IP = 100;
const MAX_CONNECTIONS_PER_USER = 10;

const sockets = new Set<Socket>();
const countByIp = new Map<string, number>();
const countByUser = new Map<string, number>();

// Slots are claimed before the upgrade, so sockets still in the handshake count against the limits too.
let claimedSlots = 0;

type SlotInput = { ip: string; user_id: string };

type ClaimOutcome = { ok: true } | { ok: false; reason: "server_full" | "ip_limit" | "user_limit" };

type AdjustInput = { counts: Map<string, number>; key: string; delta: number };

const adjust = ({ counts, key, delta }: AdjustInput) => {
  const next = (counts.get(key) ?? 0) + delta;

  if (next > 0) counts.set(key, next);
  else counts.delete(key);
};

/** Every successful claim must be paired with exactly one `releaseSlot`, or the limits leak. */
export const claimSlot = ({ ip, user_id }: SlotInput): ClaimOutcome => {
  if (claimedSlots >= MAX_CONNECTIONS) return { ok: false, reason: "server_full" };
  if ((countByIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) return { ok: false, reason: "ip_limit" };
  if ((countByUser.get(user_id) ?? 0) >= MAX_CONNECTIONS_PER_USER) return { ok: false, reason: "user_limit" };

  claimedSlots += 1;
  adjust({ counts: countByIp, key: ip, delta: 1 });
  adjust({ counts: countByUser, key: user_id, delta: 1 });

  return { ok: true };
};

export const releaseSlot = ({ ip, user_id }: SlotInput) => {
  claimedSlots -= 1;
  adjust({ counts: countByIp, key: ip, delta: -1 });
  adjust({ counts: countByUser, key: user_id, delta: -1 });
};

export const addSocket = (ws: Socket) => {
  sockets.add(ws);
};

export const removeSocket = (ws: Socket) => {
  sockets.delete(ws);
};

export const listSockets = (): ReadonlySet<Socket> => sockets;
