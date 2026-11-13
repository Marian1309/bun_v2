import { logger } from "./logger";

/** Discriminated result; after `if (error)`, `data` is narrowed to `T`. */
export type Result<T, E = Error> = { data: T; error: null } | { data: undefined; error: E };

type ToOptions = {
  /** Kebab-case label; a labelled call logs its duration at `debug`, an unlabelled one stays silent. */
  feature?: string;
};

/** Awaits `fn` into a Result instead of rejecting; any thrown value, Error or not, passes through as `error`. */
export const to = async <T, E = Error>(fn: () => Promise<T>, options?: ToOptions): Promise<Result<T, E>> => {
  const feature = options?.feature;
  const startMs = performance.now();
  const logDuration = (outcome: "ok" | "error") => {
    if (feature === undefined) return;

    const ms = Math.round(performance.now() - startMs);

    logger.debug(`⏱ ${feature} ${ms}ms${outcome === "error" ? " (failed)" : ""}`);
  };

  try {
    const data = await fn();
    logDuration("ok");

    return { data, error: null };
  } catch (error: unknown) {
    logDuration("error");

    // Thrown values are untyped; `E` is the caller's declared expectation.
    return { data: undefined, error: error as E };
  }
};

/** Sync sibling of `to()` for calls that cannot be awaited (`JSON.parse`, `new URL`). */
export const toSync = <T, E = Error>(fn: () => T): Result<T, E> => {
  try {
    return { data: fn(), error: null };
  } catch (error: unknown) {
    // Thrown values are untyped; `E` is the caller's declared expectation.
    return { data: undefined, error: error as E };
  }
};

type WithTimeoutParams<T> = {
  promise: Promise<T>;
  ms: number;
  message?: string;
};

/** Races `promise` against a timer; rejects with `message` if `ms` elapses first. */
export const withTimeout = async <T>({
  promise,
  ms,
  message = "Operation timed out"
}: WithTimeoutParams<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};
