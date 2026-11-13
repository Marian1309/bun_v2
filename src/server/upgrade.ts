import type { Server } from "bun";

import { compilePatterns } from "@/auth/channel-acl";
import type { TokenClaims } from "@/auth/jwt";
import { verifyJwt } from "@/auth/jwt";
import { env } from "@/config/env";
import { logger } from "@/core/logger";
import { readBearer } from "@/http/bearer";
import type { ConnectionData } from "@/ws/connections";
import { claimSlot, releaseSlot } from "@/ws/connections";
import { createBucket } from "@/ws/rate-limit";

import { isDraining } from "./drain";

const STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  too_many_requests: 429,
  service_unavailable: 503
} as const;

/** Subprotocol a browser offers as `new WebSocket(url, ["bearer", token])`; echoed back to complete the handshake. */
const BEARER_PROTOCOL = "bearer";

const ANY_ORIGIN = "*";
const UNKNOWN_IP = "unknown";

type RejectInput = { status: number; reason: string };

const reject = ({ status, reason }: RejectInput): Response => {
  return Response.json({ error: reason }, { status });
};

const isOriginAllowed = (origin: string | null): boolean => {
  const { ALLOWED_ORIGINS } = env.http;

  // Non-browser clients send no `Origin`; the token still gates them.
  if (origin === null) return true;
  // No allowlist: open for local development, closed to browsers in production.
  if (ALLOWED_ORIGINS.length === 0) return env.app.NODE_ENV !== "production";

  return ALLOWED_ORIGINS.includes(ANY_ORIGIN) || ALLOWED_ORIGINS.includes(origin);
};

type TokenSource = { token: string; is_subprotocol: boolean };

/** Order: subprotocol (stays out of URLs and access logs), `Authorization`, then `?token=`. */
const readToken = (request: Request): TokenSource | null => {
  const [protocol, offered] = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((part) => part.trim());

  if (protocol === BEARER_PROTOCOL && offered !== undefined) return { token: offered, is_subprotocol: true };

  const token = readBearer(request) ?? new URL(request.url).searchParams.get("token");

  return token === null ? null : { token, is_subprotocol: false };
};

type ReadClientIpInput = { request: Request; server: Server<ConnectionData> };

const readClientIp = ({ request, server }: ReadClientIpInput): string => {
  const { TRUST_PROXY_HOPS } = env.http;
  const forwarded = request.headers.get("x-forwarded-for");

  if (TRUST_PROXY_HOPS > 0 && forwarded !== null) {
    // Counted from the right: each trusted proxy appends one entry, everything further left is client-supplied.
    const hop = forwarded.split(",").at(-TRUST_PROXY_HOPS)?.trim();

    if (hop !== undefined && hop !== "") return hop;
  }

  return server.requestIP(request)?.address ?? UNKNOWN_IP;
};

type BuildDataInput = { claims: TokenClaims; ip: string };

const buildData = ({ claims, ip }: BuildDataInput): ConnectionData => ({
  connection_id: crypto.randomUUID(),
  user_id: claims.user_id,
  ip,
  expires_at_ms: claims.expires_at_ms,
  subscribe_patterns: compilePatterns(claims.can_subscribe),
  publish_patterns: compilePatterns(claims.can_publish),
  bucket: createBucket(),
  rate_limit_strikes: 0,
  subscription_count: 0
});

/** `GET /ws`: `undefined` once the socket is upgraded, otherwise the HTTP rejection. */
export const handleUpgrade = async (
  request: Request,
  server: Server<ConnectionData>
): Promise<Response | undefined> => {
  if (isDraining()) return reject({ status: STATUS.service_unavailable, reason: "draining" });
  if (!isOriginAllowed(request.headers.get("origin")))
    return reject({ status: STATUS.forbidden, reason: "origin_not_allowed" });

  const source = readToken(request);

  if (source === null) return reject({ status: STATUS.unauthorized, reason: "missing_token" });

  const verified = await verifyJwt(source.token);

  if (!verified.ok) {
    logger.debug("Upgrade rejected: invalid token", { reason: verified.reason });

    return reject({ status: STATUS.unauthorized, reason: "invalid_token" });
  }

  const slot = { ip: readClientIp({ request, server }), user_id: verified.claims.user_id };
  const claimed = claimSlot(slot);

  if (!claimed.ok) {
    const status = claimed.reason === "server_full" ? STATUS.service_unavailable : STATUS.too_many_requests;

    return reject({ status, reason: claimed.reason });
  }

  const isUpgraded = server.upgrade(request, {
    data: buildData({ claims: verified.claims, ip: slot.ip }),
    headers: source.is_subprotocol ? { "Sec-WebSocket-Protocol": BEARER_PROTOCOL } : undefined
  });

  if (isUpgraded) return;

  // No socket means no `close` event, so the slot is given back here.
  releaseSlot(slot);

  return reject({ status: STATUS.bad_request, reason: "upgrade_failed" });
};
