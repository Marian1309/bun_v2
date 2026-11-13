# bun-ws

A realtime pub/sub gateway on [Bun](https://bun.com): clients connect over WebSocket, subscribe to named channels and
publish JSON messages; backends can publish over HTTP. No runtime dependencies — Bun's native WebSocket pub/sub, Redis
client and Web Crypto.

- HS256 JWT checked during the upgrade, with per-token channel allow-lists
- Optional Redis fan-out, so any number of instances can sit behind a load balancer (no sticky sessions needed)
- Connection, subscription, payload and rate limits; slow consumers are disconnected instead of buffered
- `/healthz`, `/readyz`, graceful drain on `SIGTERM`

## Run

```bash
bun install
cp .env.example .env   # set JWT_SECRET (≥ 32 chars)
bun run dev            # watch mode
bun run start          # production entry
```

Checks: `bun run typecheck`, `bun run lint`, `bun run format`.

## Endpoints

| Method | Path       | Purpose                                                                                |
| ------ | ---------- | -------------------------------------------------------------------------------------- |
| GET    | `/ws`      | WebSocket upgrade                                                                      |
| POST   | `/publish` | Backend publish: `Authorization: Bearer <PUBLISH_API_KEY>`, body `{ channel, data }`   |
| GET    | `/healthz` | Liveness: always `200` while the process answers                                       |
| GET    | `/readyz`  | Readiness: `503` while draining or while Redis fan-out is configured but disconnected  |

## Authentication

The backend mints an HS256 JWT signed with `JWT_SECRET`:

```json
{
  "sub": "user-42",
  "exp": 1790000000,
  "can_subscribe": ["news.*", "user.42"],
  "can_publish": ["room.7"]
}
```

- `sub` and `exp` are required; `nbf` is honoured.
- A pattern is an exact channel name, or a prefix ending in `*` (`news.*`; a lone `*` allows everything). A missing list
  allows nothing.
- Channel names match `^[A-Za-z0-9_.:-]{1,128}$`.
- The socket is closed with `4401` when the token expires; the client reconnects with a fresh one.

Ways to pass the token, in order of preference:

```js
new WebSocket("wss://host/ws", ["bearer", token]); // browsers: stays out of URLs and access logs
// Authorization: Bearer <token>                    // non-browser clients
new WebSocket(`wss://host/ws?token=${token}`);      // fallback
```

Upgrade rejections are plain HTTP with `{ "error": reason }`: `401` missing / invalid token, `403` origin not allowed,
`429` per-IP or per-user connection limit, `503` server full or draining.

## Protocol

JSON text frames only. `id` is optional; when present, the reply (`ack` or `error`) echoes it.

Client → server

```json
{ "type": "subscribe", "id": "1", "channel": "news.sports" }
{ "type": "unsubscribe", "id": "2", "channel": "news.sports" }
{ "type": "publish", "id": "3", "channel": "room.7", "data": { "any": "json" } }
{ "type": "ping", "id": "4" }
```

Server → client

```json
{ "type": "welcome", "connection_id": "…", "user_id": "user-42", "expires_at": "2026-11-13T12:00:00.000Z" }
{ "type": "ack", "id": "1" }
{ "type": "error", "id": "1", "code": "forbidden", "message": "…" }
{ "type": "message", "channel": "room.7", "data": {}, "message_id": "…", "sender_id": "user-42", "sent_at": "…" }
{ "type": "pong", "id": "4" }
```

- Error codes: `invalid_message`, `invalid_channel`, `forbidden`, `rate_limited`, `too_many_subscriptions`.
- `sender_id` is the publisher's `sub`, or `null` for `POST /publish`. A publisher subscribed to the channel receives
  its own message.
- Delivery is at-most-once: there is no history, so messages published while a client is disconnected are lost.

Close codes: `1001` server shutting down, `1008` rate limit ignored (more than 20 consecutive rejected frames), `1009`
frame larger than 64 KB, `1011` internal error, `4401` token expired.

### Publishing from a backend

```bash
curl -X POST https://host/publish \
  -H "Authorization: Bearer $PUBLISH_API_KEY" -H "Content-Type: application/json" \
  -d '{"channel":"room.7","data":{"hello":"world"}}'
# 202 {"message_id":"…"}
```

## Configuration

All eight keys are documented in [`.env.example`](.env.example); only `JWT_SECRET` is required. In production:

| Key                 | Notes                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `JWT_SECRET`        | Required. The process refuses to start without it.                                              |
| `ALLOWED_ORIGINS`   | Browser origins allowed to connect. Empty in production rejects every request with an `Origin`. |
| `TRUST_PROXY_HOPS`  | Number of trusted proxies; the client IP is read that many entries from the right of `X-Forwarded-For`. Leave `0` when exposed directly, or per-IP limits can be spoofed. |
| `REDIS_URL`         | Enables multi-instance fan-out.                                                                 |
| `PUBLISH_API_KEY`   | Enables `POST /publish`.                                                                        |

## Operations

**TLS / proxy.** The server speaks plain HTTP; terminate TLS at the load balancer or reverse proxy. The proxy must
forward `Upgrade` / `Connection` headers and its idle timeout must exceed 120 s (Bun pings idle
sockets shortly before that timeout, which keeps them alive through the proxy).

**Scaling.** With `REDIS_URL` set, each publish is delivered to local subscribers immediately and forwarded once over a
single Redis pub/sub channel; other instances relay it to their own subscribers. If Redis drops, local delivery
continues, cross-instance delivery fails (logged as errors), `/readyz` returns `503`, and the
instance reconnects with backoff. Connection limits are per instance.

**Shutdown.** On `SIGTERM` / `SIGINT`: `/readyz` turns `503` and new upgrades are refused, the server waits
5 s in production (so the balancer stops routing), closes every socket with `1001`, and exits `0`; 15 s is the hard deadline. Clients
should reconnect with jittered backoff.

**Logs.** JSON lines on stdout when `NODE_ENV=production`; tokens and message payloads are never logged.

## Docker

```bash
docker build -t bun-ws .
docker run -p 3000:3000 -e JWT_SECRET=… bun-ws
```

The app ships as a single binary: the server compiled with `bun build --compile` (Bun runtime included) on `alpine` plus
`libstdc++`, run as `nobody`. The image has no `node_modules`, no Bun CLI and no source code in it. Multi-arch
(`docker buildx build --platform linux/amd64,linux/arm64`) works: each platform compiles for itself.

## Layout

```
index.ts               boot, fatal-error handlers
src/config/env.ts      the only process.env access point
src/server/            Bun.serve assembly, upgrade handshake, drain + shutdown
src/ws/                wire protocol, socket handlers, connection registry, rate limiter
src/auth/              JWT verification, channel allow-lists
src/pubsub/            broker (local delivery + Redis fan-out)
src/http/              /publish, /healthz, /readyz
src/core/              logger, to()/toSync(), validation schemas
```

## Built-in limits

Fixed in code rather than configurable; each is a named constant next to where it is enforced.

| Limit                                  | Value         | Where                       |
| -------------------------------------- | ------------- | --------------------------- |
| Frame / `POST /publish` body size      | 64 KB         | `src/server/server.ts`      |
| Idle timeout (Bun pings before it)     | 120 s         | `src/server/server.ts`      |
| Buffered bytes before a slow client is dropped | 1 MB  | `src/server/server.ts`      |
| Connections per instance / IP / user   | 10 000 / 100 / 10 | `src/ws/connections.ts` |
| Subscriptions per connection           | 100           | `src/ws/handlers.ts`        |
| Client frames per connection           | 20/s, burst 40 | `src/ws/rate-limit.ts`     |
| Shutdown drain / hard deadline         | 5 s / 15 s    | `src/server/shutdown.ts`    |
