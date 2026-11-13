# Build: bundle and compile the server into one self-contained binary (Bun runtime included, no node_modules).
FROM oven/bun:1.4.4-alpine AS build
WORKDIR /app
COPY tsconfig.json index.ts ./
COPY src ./src
# No `bun install`: the server imports only `bun` and `node:` builtins. Target follows the build platform (amd64 / arm64).
RUN arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')" \
  && bun build --compile --minify --sourcemap --target="bun-linux-${arch}-musl" index.ts --outfile server

# Runtime: bare Alpine; the musl binary links only musl libc (built in) and libstdc++.
FROM alpine:3.23
RUN apk add --no-cache libstdc++
COPY --from=build /app/server /usr/local/bin/server

ENV NODE_ENV=production
USER nobody
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

# Exec form: the server is PID 1 and receives SIGTERM directly, which starts the graceful drain.
ENTRYPOINT ["/usr/local/bin/server"]
