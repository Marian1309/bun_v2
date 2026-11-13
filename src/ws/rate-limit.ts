/** Sustained client frames per second, and the burst a quiet connection may send at once. */
const MESSAGES_PER_SECOND = 20;
const BURST = 40;

const MS_PER_SECOND = 1000;

export type Bucket = { tokens: number; updated_at_ms: number };

export const createBucket = (): Bucket => ({
  tokens: BURST,
  updated_at_ms: performance.now()
});

/** Token bucket: refills at the configured rate up to the burst size; mutates `bucket`, `false` when it is empty. */
export const takeToken = (bucket: Bucket): boolean => {
  const nowMs = performance.now();
  const refill = ((nowMs - bucket.updated_at_ms) / MS_PER_SECOND) * MESSAGES_PER_SECOND;

  bucket.tokens = Math.min(BURST, bucket.tokens + refill);
  bucket.updated_at_ms = nowMs;

  if (bucket.tokens < 1) return false;

  bucket.tokens -= 1;

  return true;
};
