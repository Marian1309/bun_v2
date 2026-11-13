const NODE_ENVS = ["development", "production", "test"] as const;
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];

// ── Readers ──

type ReadStringOptions = { default_value?: string };

/** Unset or empty → `default_value`; with none, throws naming the key. */
export const readString = (key: string, options?: ReadStringOptions): string => {
  const value = process.env[key];

  if (value !== undefined && value !== "") return value;
  if (options?.default_value !== undefined) return options.default_value;

  throw new Error(`${key} is required`);
};

export const readUrl = (key: string): string => {
  const value = readString(key);

  if (!URL.canParse(value)) throw new Error(`${key} must be a valid URL`);

  return value;
};

type ReadPositiveIntParams = { key: string; default_value: number };

/** Unset or empty → `default_value`; anything that is not a positive integer throws. */
export const readPositiveInt = ({ key, default_value }: ReadPositiveIntParams): number => {
  const parsed = Number(readString(key, { default_value: String(default_value) }));

  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${key} must be a positive integer`);

  return parsed;
};

type ReadBooleanOptions = { default_value?: boolean };

/** Unset or empty → `default_value` (false); anything but "true"/"false" throws. */
export const readBoolean = (key: string, options?: ReadBooleanOptions): boolean => {
  const value = readString(key, { default_value: String(options?.default_value ?? false) });

  if (value === "true" || value === "false") return value === "true";

  throw new Error(`${key} must be either "true" or "false"`);
};

type ReadOneOfParams<T extends string> = { key: string; values: readonly T[]; default_value: T };

export const readOneOf = <T extends string>({ key, values, default_value }: ReadOneOfParams<T>): T => {
  const value = readString(key, { default_value });
  const match = values.find((candidate) => candidate === value);

  if (match === undefined) throw new Error(`${key} must be one of: ${values.join(", ")}`);

  return match;
};

/** Validates on first access and caches, so a section nobody reads never fails the boot. */
const once = <T>(validate: () => T): (() => T) => {
  let value: T | undefined;

  return () => {
    value ??= validate();

    return value;
  };
};

// ── Sections ──

const appEnv = once(() => ({
  NODE_ENV: readNodeEnv(),
  LOG_LEVEL: readOneOf({ key: "LOG_LEVEL", values: LOG_LEVELS, default_value: "info" }),
  PORT: readPositiveInt({ key: "PORT", default_value: 3000 })
}));

export const readNodeEnv = (): NodeEnv =>
  readOneOf({ key: "NODE_ENV", values: NODE_ENVS, default_value: "development" });

/** The only `process.env` access point: one lazily validated section per domain, added as a getter here. */
export const env = {
  get app() {
    return appEnv();
  }
};
