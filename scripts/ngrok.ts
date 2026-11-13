import { join } from "node:path";

import { env } from "@/config/env";
import { logger } from "@/core/logger";
import { toSync } from "@/core/try-catch";

const NGROK_PATH = join(import.meta.dir, "..", "ngrok.exe");

// A TS wrapper, not a bare package script: Bun loads `.env` for a file it runs, but not into package-script expansion.
const { data: tunnel, error } = toSync(() => env.tunnel);

if (error) {
  logger.error("ngrok needs BASE_URL in .env, e.g. https://name.ngrok-free.app", { err: error.message });
  process.exit(1);
}

const { PORT } = env.app;

logger.info("Starting ngrok tunnel", { base_url: tunnel.BASE_URL, port: PORT });

const child = Bun.spawn([NGROK_PATH, "http", `--url=${tunnel.BASE_URL}`, String(PORT)], {
  stdio: ["inherit", "inherit", "inherit"]
});

process.exit(await child.exited);
