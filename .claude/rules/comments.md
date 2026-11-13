---
description: Comment framework — when a comment earns its place, its form and budget, how to compress one
paths: ["**/*.ts", "**/*.tsx", "**/*.css"]
---

# Comments

Detail for CLAUDE.md "Comments", which wins on conflict. The default is **no comment**: names and types say _what_; a
comment exists only to carry what the code cannot.

## 1. The test

Delete the comment in your head. **Would a competent reader now make a wrong change?**

- Yes → keep it, and make it say exactly the thing that stops that change.
- No → delete it. If the code is unclear without it, rename or extract instead of explaining.

A comment that fails the test is not harmless: it costs reading time on every visit and goes stale silently.

## 2. Budget

| Limit            | Value                                     |
| ---------------- | ----------------------------------------- |
| Block height     | ≤ 1 physical line, delimiters included    |
| Line width       | ≤ 120 characters, indentation excluded    |
| `TODO` / `FIXME` | must name an owner: `TODO(name): …`       |
| Trailing comment | never — own line above the statement (§5) |

A block is every consecutive comment line: a `//` run stacked on a JSDoc is **one** block. Over the cap → compress per
§6; never split a block with a blank line or a statement to get under it.

## 3. What earns a comment

| Reason                         | Shape                                                             |
| ------------------------------ | ----------------------------------------------------------------- |
| Why this value                 | `/** <what it bounds> (<unit/derivation>); <why this number>. */` |
| Decision between valid options | `// <choice>: <reason>.`                                          |
| Order or invariant             | `// <X> before <Y>: <what breaks otherwise>.`                     |
| Security or privacy            | `// <constraint>: <attack it closes>.`                            |
| Workaround                     | `// <library/platform quirk> — <what we do instead>.`             |
| Hidden second effect           | `// <expression> also <covers case B>.`                           |
| Contract of an export          | `/** <what the caller can rely on>; <failure mode>. */`           |
| `as` cast, lint suppression    | why the checker is wrong here                                     |

## 4. What never does

- **Restating the code** — `// loop over users`, `/** Gets the user. */`.
- **Narrating steps** — `// first we parse, then we sort`. Extract named functions instead.
- **History** — `// changed from X`, `// fixed bug where…`. That is the commit message.
- **Signature echo** — `@param id the id`, `@returns the result`.
- **Conversation residue** — `// as requested`, `// per review`.
- **Hedging** — `// this should probably work`. Verify, then say nothing.
- **Commented-out code.** Delete it; git keeps it.
- **Section banners in short files.**

## 5. Form

- **Exports, module constants, type fields**: when one earns a comment, a one-line JSDoc `/** … */` so editors show it
  on hover.
- **Inside a function**: `//` on its own line directly above the statement it explains. Never trailing.
- **Backtick identifiers** (`` `retry()` ``) so a rename search finds the comment too.
- Present tense, no "we", no "note that", no "basically". Start with the reason, not with "This".
- English only. Unicode punctuation is fine (`—`, `→`, `§`).

## 6. Compressing

Cut in this order and stop as soon as it fits:

1. **Delete what the code says.**
2. **Lead with the reason.** `X: because Y` beats `We need to do X here since it turns out that Y`.
3. **Drop filler** — "in order to", "make sure that", "note that", "currently", "simply", "just".
4. **Replace prose with a symbol**: `→`, `≠`, `§5`, `` `name` ``.
5. **Split the content, not the block**: part of it usually belongs on a different line (a constant's JSDoc, the callee's
   contract).
6. **Still too long?** It is documentation. Move it to `<name>.md` beside the file and leave one line:
   `// See <name>.md — <the one fact a reader needs here>.`

```ts
// DON'T — 2 lines, narrates, repeats the code, buries the reason
// Here we loop over the entries and parse each quality value, then filter out
// the ones that are zero or NaN by checking that the weight is greater than zero.
.filter((entry) => entry.weight > 0)

// DO — the two facts a reader cannot see, nothing else
// `weight > 0` drops q=0 ("not acceptable") and a malformed q, which parses to NaN.
.filter((entry) => entry.weight > 0)
```

## 7. When the code changes

A comment is part of the statement below it: edit them together. When a change makes a comment false, fix or delete it
in the same edit. Do not rewrite comments in code the task does not touch.
