---
description: Language-level TypeScript rules — functions, types, narrowing, errors, imports
paths: ["**/*.ts", "**/*.tsx"]
---

# Code Style

Language-level rules only — how TypeScript is written in this repo. `CLAUDE.md` wins on conflict.

Every rule is the target style: new and edited code follows it even where older code has not caught up. Most are
machine-enforced by Biome, so a violation fails `bun run lint`. Every snippet below is written in repo style — double quotes, semicolons — so it doubles as a formatting example.

---

## 1. Functions

Arrow functions assigned to a `const`. No `function` declarations, no `function` expressions, no generator functions,
no `class`. This includes event handlers and callbacks.

```ts
export const getUser = async ({ db, id }: GetUserParams) => {
  …
};
```

- **`async` + explicit `Promise<T>` return type** on anything whose return isn't obvious at a glance. Trivial returns
  may be inferred.
- **Early return** as soon as the result is determined; no `else` after a `return`.
- **No `this`.** Arrow functions don't bind it, and there are no classes to need it.
- Default parameter values are fine; non-primitive defaults are hoisted to a module constant so the identity is stable:

```ts
const NOOP = () => {};

const subscribe = ({ onChange = NOOP }: SubscribeInput) => { … };
```

### Parameters

At most one positional parameter plus an optional trailing `options`; otherwise one object. The object's type is a
separately named `type` declared immediately above the function:

```ts
// DO
type WithTimeoutParams = {
  promise: Promise<unknown>;
  ms: number;
  message: string;
};

const withTimeout = async ({ promise, ms, message }: WithTimeoutParams) => { … };

// DON'T — inline type
const withTimeout = async ({ promise, ms }: { promise: Promise<unknown>; ms: number }) => { … };

// DON'T — positional pile-up
const withTimeout = async (promise, ms, message) => { … };
```

An optional trailing `options` object is the one accepted second parameter:

```ts
export const to = async <T, E = Error>(fn: () => Promise<T>, options?: ToOptions): Promise<Result<T, E>> => { … };
```

Exempt only signatures a framework or library imposes (reducers, `Array.prototype` callbacks), not our own helpers.

---

## 2. Types

`type` only, never `interface`, except inside `declare module` / `declare global` augmentation, where declaration
merging needs it.

```ts
type ToOptions = {
  feature?: string;
  performance?: boolean;
};
```

- **Module-private by default.** Export a type only when it's part of the module's contract.
- Declare a param/return type **immediately above** the function that uses it.
- **No `any`.** Use `unknown` and narrow (see below).
- **No enums.** Use an `as const` object plus a derived union:

```ts
export const PERMISSIONS = {
  app_user: "app:user",
  system_admin: "system:admin",
} as const;

export type AppPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
```

- **`as const` narrows literals.** `satisfies` checks a literal against a type without widening it —
  `[…] as const satisfies readonly Option[]`.
- Generics take defaults where useful: `<T, E = Error>`.
- Prefer `Type[]` over `Array<Type>`.
- Expected failures are modelled as discriminated unions rather than thrown errors — see §5.

### Narrowing, not casting

A cast tells the compiler to stop checking. Narrowing proves the type at runtime, so the check and the type stay in
sync. `as X` is a last resort, acceptable only at a genuinely untyped boundary, with a why-comment. Reach for these in
order:

- **`typeof` / `Array.isArray`** for primitives and arrays:

```ts
// DO
if (typeof value !== "string") return null;
if (!Array.isArray(parts)) return [];

// DON'T — the cast is a lie the moment the input shape changes
const text = value as string;
const list = parts as MessagePart[];
```

- **`in`** to discriminate a union without a tag field: `if ("error" in result) return result.error`.
- **A user-defined predicate** when the check is reused or non-trivial. Name it `is*`/`has*`, return `value is X`, keep
  it a pure expression:

```ts
type ErrorWithStatus = Error & { status: number };

export const hasStatus = (error: unknown): error is ErrorWithStatus =>
  error instanceof Error && "status" in error && typeof error.status === "number";
```

- **A `@/core/validate` schema** at any boundary carrying real data (request bodies, provider responses, files). A parse gives
  you the narrowed type _and_ rejects bad input; a cast gives you neither.
- **Never the non-null assertion `!`.** `value!.id` is a cast with better PR camouflage — write the guard, or fix the
  type that shouldn't have been nullable.

### Type-name suffixes

| Suffix                 | Used for                                    |
| ---------------------- | ------------------------------------------- |
| `…Params`              | object parameter of a data-access function  |
| `…Input`               | object parameter of a domain/service function |
| `…Options`             | optional trailing options bag               |
| `…Result` / `…Outcome` | discriminated return union                  |
| `Properties`           | component props                             |

---

## 3. Naming

Files kebab-case · variables, locals and functions camelCase · types PascalCase · constants `UPPER_SNAKE_CASE` ·
generic type params a single uppercase letter (`T`, `E`).

**Object keys and properties we own are snake_case**: static data/config objects, parameter objects
(`({ db, user_id })`), fields of our types, results and state, validation schema keys, our JSON bodies. **Keys whose
value is a function are camelCase** (`onChange`, `onConfirm`). Local variables and functions stay camelCase.
Destructuring keeps the key's name (`({ db, user_id })`); don't rename to camelCase.

```ts
type ClaimQuotaParams = { db: Db; user_id: string; declared_bytes: number };

const claimQuota = async ({ db, user_id, declared_bytes }: ClaimQuotaParams) => { … };
```

**Externally dictated names keep the library's casing**: DOM/library options (`className`, `signal`, `headers`),
SDK shapes, env vars and HTTP headers.

Booleans `is_*`/`has_*`/`can_*` as keys, `is*`/`has*`/`can*` as locals · event handlers `handle*`.

Verb prefixes carry meaning: `is*`/`has*` are predicates · `get*`/`find*`/`select*`/`list*` read ·
`insert*`/`set*`/`mark*`/`claim*`/`release*` write.

Names are spelled out — no abbreviations beyond established ones (`id`, `db`, `ms`, `url`).

---

## 4. Variables & control flow

- **`const` by default**, `let` only when reassignment is real. Never `var`.
- **Functional updates** when the new value derives from the old: `setItems((current) => [...current, item])`.
- **Immutable array ops**: `.toSorted()` / `.toReversed()`, never in-place `.sort()` on shared data.
- **`??` over `||`** for defaults, so `0` and `""` survive. `?.` for optional access.
- **`===` always** — write `x === null` / `x === undefined`.
- **No shadowing**, no parameter reassignment, no nested ternaries.
- **Prefer `for...of`** over `.forEach`; a single loop beats chained `.filter().map()` on a hot path.
- **`Set`/`Map` for repeated lookups** instead of `.includes()` / `.find()` in a loop.
- **`Number.parseInt` / `Number.parseFloat`**, never the globals, and `parseInt` always gets an explicit radix:
  `Number.parseInt(raw, 10)`. Prefer `Number(raw)` when the whole string must be a number — `parseInt("12abc")` silently
  returns `12`. Untrusted input: `number({ coerce: true })` from `@/core/validate`.
- **Regex literals are hoisted to module scope**:

```ts
const SLUG_PATTERN = /[^a-z0-9]+/g;

const slugify = (value: string) => value.toLowerCase().replace(SLUG_PATTERN, "-");
```

### Magic values

**A literal needs a name only where nothing else names it.** A bare number or string in a condition or an expression —
a limit, a threshold, a key prefix — becomes an `UPPER_SNAKE_CASE` constant:

```ts
// DO
/** Declared bytes a user may register per rolling day (25 MB). */
export const MAX_DAILY_UPLOAD_BYTES = 25 * 1024 * 1024;

if (declaredBytes > MAX_DAILY_UPLOAD_BYTES) return { ok: false, reason: "quota_exceeded" };

// DON'T
if (declaredBytes > 26214400) return { ok: false, reason: "quota_exceeded" };
```

**The key is the name.** A value used once as an object field, a named option or a property assignment stays inline:
`{ timeout_ms: 5_000 }` already says what it is; a constant `REQUEST_TIMEOUT_MS` only repeats the key one screen away.
Put a non-obvious _why_ in a comment above the key.

- **Extract only when** the value has no key to name it, when several places must stay equal, or when another module
  needs it.
- Numeric literals use separators for magnitude (`3_000`, `1_000_000`); arithmetic stays un-collapsed when it shows the
  derivation (`60 * 60 * 24 * 2` beats `172800`).
- A closed set of strings is an `as const` object with a derived union (§2), never bare literals compared across files.
- **Accepted inline literals**: `0`, `1`, `-1` and array indices · `""` and `[]` as empty initializers · the radix in
  `Number.parseInt(raw, 10)` · values inside a constants file itself.

---

## 5. Async & errors

### `async` / `await`

- `async`/`await` only. No `.then()` / `.catch()` chains, no callback style, no `new Promise` wrapper around something
  that is already a promise.
- An `async` function that never `await`s anything is a mistake — drop the `async` or fix the body.
- **No `await` inside a loop** when the iterations are independent. Loop only when each step needs the previous one's
  result, or when deliberately rate-limiting (then `Promise.all` in fixed-size batches).
- **Defer the `await` into the branch that uses it** — don't block on a result a code path may never read.
- **Floating promises are a bug.** `await` it, or hand it to something that owns it.
- `await` catches throws, not hangs. Bound anything that talks to the outside world with `withTimeout(...)` or
  `AbortSignal.timeout(...)`.
- **`Promise.all`** for independent work, destructuring the tuple: `const [user, config] = await Promise.all([…]);`

### `to()` — errors as values

**No inline `try`/`catch` in application code.** Wrap the fallible call in `to()` (or `toSync()`) and branch on the
result (`@/core/try-catch`). `try`/`catch` is reserved for boundary wrappers that need catch-all / rethrow / `finally` (the `to()` helper
itself, top-level entry points).

```ts
const { data, error } = await to(() => fetchThing(id));

if (error) {
  logger.error("Thing could not be fetched", { id, err: error });

  return null;
}
```

- `to<T, E = Error>(fn, options?)` returns `{ data: T; error: null } | { data: undefined; error: E }`.
- The argument is a **thunk**: `to(() => fn())`, never `to(fn())`.
- Several results in one scope: **rename on destructure** — `const { data: url, error: urlError } = await to(…)`.
- **Best-effort side effects** (analytics, cache writes) are `to()`-wrapped and only logged.
- In boundary wrappers: `catch (error: unknown)`, never `any`; a bare `catch {}` only with a comment saying why.

### Result unions over throws

Expected failures are **return values**:

```ts
/** `provider_error` — provider rejected; `in_progress` — another worker holds the claim. */
type SettleOutcome = { ok: true; status: string } | { ok: false; reason: "provider_error" | "in_progress" };
```

- Discriminate on `ok`, with a string `reason`.
- The union is the contract — don't smuggle failures out through `null`, a sentinel, or a thrown string.
- Callers forward a failure unchanged (`if (!result.ok) return result`).
- **Throwing is reserved for genuinely exceptional paths**: a bug or an impossible state; deliberate and commented.
- Branch data on an error goes on a plain `Error` (`Object.assign(new Error(message), { status })`) — no `class`
  subtypes. Throw only `Error`s; pass `{ cause }` when rethrowing.

---

## 6. Imports & exports

- **Named exports only.** `export default` only where a tool requires it (config files).
- **Export inline at the declaration** (`export const Foo = …`); never a trailing `export { Foo }` block.
- **No barrel files, no `export *`.**
- **Named imports only, never a namespace**: `import { readFile } from "node:fs/promises"`, never `import * as fs`.
  Alias on a name clash.
- **`import type` on its own statement**, separated from value imports:

```ts
import type { Server } from "bun";
import { join } from "node:path";
```

- **Node builtins always carry the `node:` prefix.**
- **Logging** via `logger` (`@/core/logger`), message-first: `logger.info("Order placed", { order_id })`; `console` is a
  Biome error outside the logger.

---

## 7. Formatting

Biome owns it (`bun run format`): 2-space indent, double quotes, semicolons, no trailing commas, line width 120, sorted
import groups. Blank lines and comments: CLAUDE.md.
