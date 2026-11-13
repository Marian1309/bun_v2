# Agent operating rules

Detail and examples: `.claude/rules/code-style.md`, `.claude/rules/comments.md` (auto-loaded for TS files). This file
wins on conflict.

## Toolchain

- **Bun only** (`bun`, `bunx`, `bun add`); never npm/npx/pnpm/yarn/node/ts-node/jest/vitest. Pin exact versions on
  `bun add` and check the `package.json` diff.
- Typecheck `bun run typecheck`; lint + format + imports `bun run lint` (Biome); `bun run format` fixes.
- **No tests.** Tests are banned in this repo: no `*.test.ts`, no `bun:test`, no test runners or test deps.
- **Env.** `import { env } from "@/config/env"`: one lazily validated section per domain (getter on `env`), built from the
  `read*` helpers there; `process.env` is a Biome error everywhere else. A new key → entry in `.env.example`.
- Imports: `@/*` → `src/*`. Core helpers: `@/core/try-catch` (`to`, `toSync`, `withTimeout`), `@/core/validate`
  (schemas, `schema.check(input)` never throws), `@/core/logger` (message-first, never `console`).
- Commits: one line `type(scope): subject` (`feat|fix|perf|refactor|docs|chore|build|test`, imperative, lowercase,
  ≤ 72 chars).

## Code style - MUST

- Arrow functions only (handlers, callbacks too); no `function`, no `class`, no `enum`, no `interface` (outside
  `declare module` / `declare global`), no `any`, no non-null `!`.
- ≤ 1 positional param + optional trailing `options`; otherwise one object with a separately named `type` declared
  directly above the function. Exempt only signatures a framework/library imposes (`Array.prototype` callbacks, reducers).
- Keys we own are snake_case; function-valued keys camelCase (`onSelect`); library names keep their casing.
- `try/catch` only in boundary wrappers; elsewhere `to()` / `toSync()` → `{ data, error }`. Expected failures are
  `{ ok: false, reason }` unions, not throws. `as` only at untyped boundaries with a why-comment.
- `async`/`await` only, no `.then()` chains; independent work via `Promise.all`; no floating promises.
- Named exports only, inline at the declaration; `import type` on its own statement; `node:` prefix on builtins; no
  namespace imports, no barrels.
- `const` by default; `??` over `||`; `===` always; `.toSorted()` over in-place `.sort()`; regex literals hoisted to module
  scope; a bare literal in a condition/expression gets an `UPPER_SNAKE` name, a once-used object field stays inline.
- Comments: only _why_; a block (`//` runs, `/** */`; delimiters count) is 1 line ≤ 120 chars; a comment added above
  another merges into one block; no trailing comments; `TODO(owner):`.
- Blank line before every `return` / `throw` and around block statements unless first in block; consecutive one-line
  guards stay tight. The blank line goes above a statement's comment.

## Before yielding

- `bun run typecheck` when types changed; `bun run lint` after any code change.
