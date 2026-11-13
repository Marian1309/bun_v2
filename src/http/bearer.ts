import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

export const readBearer = (request: Request): string | null => {
  const header = request.headers.get("authorization");

  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;
};

// Hashed first: `timingSafeEqual` needs equal lengths, and a length check alone would leak the secret's length.
const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest();

type HasBearerInput = { request: Request; secret: string };

/** Constant-time comparison of the request's bearer token against `secret`. */
export const hasBearer = ({ request, secret }: HasBearerInput): boolean => {
  const token = readBearer(request);

  return token !== null && timingSafeEqual(digest(token), digest(secret));
};
