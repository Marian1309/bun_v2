import { env } from "@/config/env";

export type LogFields = Record<string, unknown>;

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

type LogLevel = keyof typeof LOG_LEVELS;

const MIN_LEVEL = env.app.LOG_LEVEL;
const IS_JSON = env.app.NODE_ENV === "production";

/** Cycles and Error's non-enumerable fields would otherwise throw or serialize as `{}`. */
const createReplacer = () => {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown) => {
    if (value instanceof Error) return { ...value, name: value.name, message: value.message, stack: value.stack };

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";

      seen.add(value);
    }

    return value;
  };
};

const serialize = (value: unknown) => JSON.stringify(value, createReplacer());

type WriteInput = { level: LogLevel; message: string; fields?: LogFields };

const write = ({ level, message, fields }: WriteInput) => {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

  const time = new Date().toISOString();
  const line = IS_JSON
    ? serialize({ time, level, message, ...fields })
    : `${time} ${level.toUpperCase().padEnd(5)} ${message}${fields ? ` ${serialize(fields)}` : ""}`;

  console[level](line);
};

/** Message-first: `logger.info("Order placed", { order_id })`; JSON lines when `NODE_ENV=production`. */
export const logger = {
  debug: (message: string, fields?: LogFields) => write({ level: "debug", message, fields }),
  info: (message: string, fields?: LogFields) => write({ level: "info", message, fields }),
  warn: (message: string, fields?: LogFields) => write({ level: "warn", message, fields }),
  error: (message: string, fields?: LogFields) => write({ level: "error", message, fields })
};
