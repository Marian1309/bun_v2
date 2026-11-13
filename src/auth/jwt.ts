import { env } from "@/config/env";
import { toSync } from "@/core/try-catch";
import { array, number, object, optional, string } from "@/core/validate";

/** Longest token accepted (characters): bounds the HMAC and JSON work an unauthenticated peer can force. */
const MAX_TOKEN_LENGTH = 4096;

/** Allow-list entries per direction: keeps the per-message pattern scan short. */
const MAX_PATTERNS = 64;

/** Seconds a token may be used before its `nbf`: absorbs clock drift between the issuer and this host. */
const CLOCK_SKEW_SECONDS = 5;

const MS_PER_SECOND = 1000;
const SUPPORTED_ALGORITHM = "HS256";

const patternListSchema = optional(array(string({ nonempty: true, max: 129 }), { max: MAX_PATTERNS }));

const headerSchema = object({ alg: string() });

const claimsSchema = object({
  sub: string({ nonempty: true, max: 128 }),
  exp: number(),
  nbf: optional(number()),
  can_subscribe: patternListSchema,
  can_publish: patternListSchema
});

export type TokenClaims = {
  user_id: string;
  expires_at_ms: number;
  can_subscribe: string[];
  can_publish: string[];
};

type VerifyFailure =
  | "malformed"
  | "unsupported_algorithm"
  | "bad_signature"
  | "bad_claims"
  | "expired"
  | "not_yet_valid";

export type VerifyOutcome = { ok: true; claims: TokenClaims } | { ok: false; reason: VerifyFailure };

const encoder = new TextEncoder();

let keyPromise: Promise<CryptoKey> | undefined;

const getKey = (): Promise<CryptoKey> => {
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    encoder.encode(env.auth.JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return keyPromise;
};

/** Undecodable or non-JSON input → `undefined`, which every schema rejects. */
const decodePart = (part: string): unknown =>
  toSync<unknown>(() => JSON.parse(Buffer.from(part, "base64url").toString("utf8"))).data;

const fail = (reason: VerifyFailure): VerifyOutcome => ({ ok: false, reason });

const checkClaims = (payload: unknown): VerifyOutcome => {
  const parsed = claimsSchema.check(payload);

  if (!parsed.ok) return fail("bad_claims");

  const { sub, exp, nbf, can_subscribe, can_publish } = parsed.value;
  const nowSeconds = Date.now() / MS_PER_SECOND;

  if (exp <= nowSeconds) return fail("expired");
  if (nbf !== undefined && nbf > nowSeconds + CLOCK_SKEW_SECONDS) return fail("not_yet_valid");

  return {
    ok: true,
    claims: {
      user_id: sub,
      expires_at_ms: exp * MS_PER_SECOND,
      can_subscribe: can_subscribe ?? [],
      can_publish: can_publish ?? []
    }
  };
};

/** HS256 only, signature checked before any claim is read; never throws. */
export const verifyJwt = async (token: string): Promise<VerifyOutcome> => {
  if (token.length > MAX_TOKEN_LENGTH) return fail("malformed");

  const [header, payload, signature, ...extra] = token.split(".");

  if (header === undefined || payload === undefined || signature === undefined || extra.length > 0)
    return fail("malformed");

  const parsedHeader = headerSchema.check(decodePart(header));

  if (!parsedHeader.ok) return fail("malformed");
  // Pinned: honouring the token's own `alg` would let `none` or a key-confusion algorithm through.
  if (parsedHeader.value.alg !== SUPPORTED_ALGORITHM) return fail("unsupported_algorithm");

  const isValid = await crypto.subtle.verify(
    "HMAC",
    await getKey(),
    Buffer.from(signature, "base64url"),
    encoder.encode(`${header}.${payload}`)
  );

  if (!isValid) return fail("bad_signature");

  return checkClaims(decodePart(payload));
};
