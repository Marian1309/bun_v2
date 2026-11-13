// In-house validation: plain functions, no dependencies, Standard Schema v1 compatible (`~standard`).

/** One failed rule; `path` leads from the root value to the offending field (`["roles", 2]`). */
export type Issue = { message: string; path: PropertyKey[] };

export type CheckResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** A JSON Schema object (draft-07 / 2020-12 common subset), as LLM tool / structured-output APIs take it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Standard Schema v1 + Standard JSON Schema (per the specs): libraries that accept Standard Schema take ours directly. */
type StandardSchemaV1<T> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: T } | { issues: readonly Issue[] };
    readonly types?: { readonly input: unknown; readonly output: T };
    readonly jsonSchema: { readonly input: () => JsonSchema; readonly output: () => JsonSchema };
  };
};

export type Schema<T> = StandardSchemaV1<T> & {
  /** Never throws: `{ ok: true, value }` with trimmed / coerced output, or every issue found. */
  readonly check: (input: unknown) => CheckResult<T>;
  /** Built once at creation, so `check()` never pays for it; read through `toJsonSchema`. */
  readonly json: JsonSchema;
  /** Set by `optional()`: `object()` leaves such keys out of `required`. */
  readonly is_optional?: true;
  /** Set by `object()` only: per-field schemas, so a form re-checks one field; wrappers drop it (cross-field rules). */
  readonly shape?: Readonly<Record<string, Schema<unknown>>>;
};

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Messages<R extends string> = { messages?: Partial<Record<R, string>> };

const DEFAULT_MESSAGES = {
  required: "Required",
  type: "Invalid value",
  format: "Invalid format"
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const ok = <T>(value: T): CheckResult<T> => ({ ok: true, value });

const fail = (message: string): CheckResult<never> => ({ ok: false, issues: [{ message, path: [] }] });

type AppendIssuesInput = { into: Issue[]; issues: Issue[]; key: PropertyKey };

/** Appends a child's issues under `key`; in place, so a failing field allocates its issue and nothing else. */
const appendIssues = ({ into, issues, key }: AppendIssuesInput) => {
  for (const issue of issues)
    into.push({ message: issue.message, path: issue.path.length === 0 ? [key] : [key, ...issue.path] });
};

type DefineSchemaInput<T> = {
  check: (input: unknown) => CheckResult<T>;
  json: JsonSchema;
  is_optional?: true;
  shape?: Readonly<Record<string, Schema<unknown>>>;
};

const defineSchema = <T>({ check, json, is_optional, shape }: DefineSchemaInput<T>): Schema<T> => ({
  check,
  json,
  ...(is_optional ? { is_optional } : {}),
  ...(shape ? { shape } : {}),
  "~standard": {
    version: 1,
    vendor: "app",
    validate: (value) => {
      const result = check(value);

      return result.ok ? { value: result.value } : { issues: result.issues };
    },
    // One shape for both: models are told the output type (`coerce` strings are a form / query-param concern).
    jsonSchema: { input: () => json, output: () => json }
  }
});

/** Drops `undefined` entries, so unset options never reach the emitted JSON Schema. */
const compact = (entries: Record<string, unknown>): JsonSchema =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

type TypeFailureInput = Messages<"required" | "type"> & { input: unknown };

/** `undefined` reads as a missing field ("Required"), anything else of the wrong type as "Invalid value". */
const typeFailure = ({ input, messages }: TypeFailureInput) =>
  fail(
    input === undefined ? (messages?.required ?? DEFAULT_MESSAGES.required) : (messages?.type ?? DEFAULT_MESSAGES.type)
  );

type StringOptions = Messages<"required" | "type" | "min" | "max" | "pattern" | "format"> & {
  /** Trims before the length checks; the parsed value is the trimmed one. */
  trim?: boolean;
  /** `""` fails with the "required" message, checked first (native `required` semantics). */
  nonempty?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  /** `date` is ISO 8601 `YYYY-MM-DD`; `date-time` adds a time with a `Z` or `±hh:mm` offset. */
  format?: "email" | "url" | "uuid" | "date" | "date-time";
};

// Round trip: engines roll an impossible day (`2023-02-29`) into the next month instead of rejecting it.
const isCalendarDate = (value: string) =>
  DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value);

const FORMAT_CHECKS = {
  email: (value: string) => EMAIL_PATTERN.test(value),
  url: (value: string) => URL.canParse(value),
  uuid: (value: string) => UUID_PATTERN.test(value),
  date: isCalendarDate,
  // The date part alone: a whole-instant round trip would compare a `+02:00` value against its UTC date.
  "date-time": (value: string) =>
    DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && isCalendarDate(value.slice(0, 10))
} as const;

/** A rule returns its failure message, or `null` when the value passes. */
type Rule<T> = (value: T) => string | null;

type FirstFailureInput<T> = { value: T; rules: Rule<T>[] };

const firstFailure = <T>({ value, rules }: FirstFailureInput<T>): CheckResult<T> => {
  for (const rule of rules) {
    const message = rule(value);

    if (message !== null) return fail(message);
  }

  return ok(value);
};

type BoundsInput<T> = Messages<"min" | "max"> & {
  min?: number;
  max?: number;
  measure: (value: T) => number;
  /** Appended to the default message: `" characters"`, `" items"`, or `""` for plain numbers. */
  unit: string;
};

/** Built once per schema, so `check()` runs only the rules that were configured. */
const boundsRules = <T>({ min, max, measure, unit, messages }: BoundsInput<T>): Rule<T>[] => {
  const rules: Rule<T>[] = [];

  if (min !== undefined)
    rules.push((value) => (measure(value) < min ? (messages?.min ?? `Must be at least ${min}${unit}`) : null));
  if (max !== undefined)
    rules.push((value) => (measure(value) > max ? (messages?.max ?? `Must be at most ${max}${unit}`) : null));

  return rules;
};

export const string = (options?: StringOptions): Schema<string> => {
  const { trim = false, nonempty = false, min, max, pattern, format, messages } = options ?? {};
  const rules = boundsRules<string>({ min, max, messages, measure: (value) => value.length, unit: " characters" });

  if (nonempty) rules.unshift((value) => (value === "" ? (messages?.required ?? DEFAULT_MESSAGES.required) : null));

  if (pattern) {
    // A private copy rewound per call: `g` / `y` keep `lastIndex`, so one value would pass and fail in turn.
    const matcher = new RegExp(pattern);

    rules.push((value) => {
      matcher.lastIndex = 0;

      return matcher.test(value) ? null : (messages?.pattern ?? DEFAULT_MESSAGES.format);
    });
  }

  if (format) {
    const matches = FORMAT_CHECKS[format];

    rules.push((value) => (matches(value) ? null : (messages?.format ?? DEFAULT_MESSAGES.format)));
  }

  return defineSchema({
    check: (input) =>
      typeof input === "string"
        ? firstFailure({ value: trim ? input.trim() : input, rules })
        : typeFailure({ input, messages }),
    json: compact({
      type: "string",
      minLength: nonempty ? Math.max(min ?? 1, 1) : min,
      maxLength: max,
      pattern: pattern?.source,
      // JSON Schema names a URL `uri`.
      format: format === "url" ? "uri" : format
    })
  });
};

type NumberOptions = Messages<"required" | "type" | "min" | "max" | "integer"> & {
  min?: number;
  max?: number;
  integer?: boolean;
  /** Accepts numeric strings (query params, form fields); an empty string stays missing. */
  coerce?: boolean;
};

export const number = (options?: NumberOptions): Schema<number> => {
  const { coerce = false, integer = false, min, max, messages } = options ?? {};
  const rules = boundsRules<number>({ min, max, messages, measure: (value) => value, unit: "" });

  if (integer)
    rules.unshift((value) => (Number.isInteger(value) ? null : (messages?.integer ?? "Must be a whole number")));

  const toNumber = (input: unknown) =>
    coerce && typeof input === "string" && input.trim() !== "" ? Number(input) : input;

  return defineSchema({
    check: (input) => {
      const value = toNumber(input);

      // Finite only: `Infinity` (or `"Infinity"` coerced) would pass a `min`-only bound and reach a `LIMIT`.
      if (typeof value !== "number" || !Number.isFinite(value))
        return typeFailure({ input: input === "" ? undefined : input, messages });

      return firstFailure({ value, rules });
    },
    json: compact({ type: integer ? "integer" : "number", minimum: min, maximum: max })
  });
};

export const boolean = (options?: Messages<"required" | "type">): Schema<boolean> =>
  defineSchema({
    check: (input) => (typeof input === "boolean" ? ok(input) : typeFailure({ input, messages: options?.messages })),
    json: { type: "boolean" }
  });

export const literal = <const T extends string | number | boolean | null>(
  value: T,
  options?: Messages<"required" | "type">
): Schema<T> =>
  defineSchema({
    check: (input) => (input === value ? ok(value) : typeFailure({ input, messages: options?.messages })),
    json: { const: value }
  });

/** One of a closed set of values (zod's `enum`). */
export const picklist = <const T extends readonly (string | number)[]>(
  values: T,
  options?: Messages<"required" | "type">
): Schema<T[number]> => {
  const allowed = new Set<unknown>(values);

  return defineSchema({
    check: (input) =>
      // Cast: `allowed` holds exactly `values`, so a hit is one of `T`'s members.
      allowed.has(input) ? ok(input as T[number]) : typeFailure({ input, messages: options?.messages }),
    json: { enum: [...values] }
  });
};

type ArrayOptions = Messages<"required" | "type" | "min" | "max"> & { min?: number; max?: number };

export const array = <T>(item: Schema<T>, options?: ArrayOptions): Schema<T[]> => {
  const { min, max, messages } = options ?? {};
  const rules = boundsRules<unknown[]>({ min, max, messages, measure: (list) => list.length, unit: " items" });

  return defineSchema({
    check: (input) => {
      if (!Array.isArray(input)) return typeFailure({ input, messages });

      const size = firstFailure({ value: input, rules });

      if (!size.ok) return size;

      const values: T[] = [];
      const issues: Issue[] = [];

      // Index loop: `entries()` allocates an `[index, entry]` pair per item, the main cost of a long list.
      for (let index = 0; index < input.length; index += 1) {
        const result = item.check(input[index]);

        if (result.ok) values.push(result.value);
        else appendIssues({ into: issues, issues: result.issues, key: index });
      }

      return issues.length > 0 ? { ok: false, issues } : ok(values);
    },
    json: compact({ type: "array", items: item.json, minItems: min, maxItems: max })
  });
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ReadOwnInput = { input: Record<string, unknown>; key: string };

/** Own keys only: a shape key like `valueOf` would otherwise read `Object.prototype`'s function. */
const readOwn = ({ input, key }: ReadOwnInput) => (Object.hasOwn(input, key) ? input[key] : undefined);

type Shape = Record<string, Schema<unknown>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Fields whose schema accepts `undefined` become optional keys, like zod's object output. */
type InferShape<S extends Shape> = Simplify<
  { [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]> } & {
    [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>;
  }
>;

type ObjectOptions = Messages<"required" | "type"> & {
  /** Copies keys outside `shape` through unchecked (zod's `looseObject`), e.g. SDK parts that must round-trip. */
  keep_unknown?: boolean;
};

/** Checks every field and reports all issues; keys outside `shape` are dropped unless `keep_unknown`. */
export const object = <S extends Shape>(shape: S, options?: ObjectOptions): Schema<InferShape<S>> => {
  const entries = Object.entries(shape);
  const keepUnknown = options?.keep_unknown === true;

  return defineSchema({
    check: (input) => {
      if (!isRecord(input)) return typeFailure({ input, messages: options?.messages });

      const value: Record<string, unknown> = keepUnknown ? { ...input } : {};
      const issues: Issue[] = [];

      for (const [key, schema] of entries) {
        const result = schema.check(readOwn({ input, key }));

        if (!result.ok) appendIssues({ into: issues, issues: result.issues, key });
        else if (result.value === undefined) delete value[key];
        else value[key] = result.value;
      }

      // Cast: every key of `shape` passed its own schema, which is exactly what `InferShape` describes.
      return issues.length > 0 ? { ok: false, issues } : ok(value as InferShape<S>);
    },
    // Unknown keys are dropped on check, so the model is told it may not add any.
    json: {
      type: "object",
      properties: Object.fromEntries(entries.map(([key, schema]) => [key, schema.json])),
      required: entries.filter(([, schema]) => !schema.is_optional).map(([key]) => key),
      additionalProperties: keepUnknown
    },
    shape
  });
};

/** String-keyed map whose every value passes `value` (zod's `record`). */
export const record = <T>(value: Schema<T>, options?: Messages<"required" | "type">): Schema<Record<string, T>> =>
  defineSchema({
    check: (input) => {
      if (!isRecord(input)) return typeFailure({ input, messages: options?.messages });

      const output: Record<string, T> = {};
      const issues: Issue[] = [];

      for (const [key, entry] of Object.entries(input)) {
        const result = value.check(entry);

        // Defined, not assigned: `output["__proto__"] = …` from parsed JSON would swap the prototype instead.
        if (result.ok)
          Object.defineProperty(output, key, {
            value: result.value,
            enumerable: true,
            writable: true,
            configurable: true
          });
        else appendIssues({ into: issues, issues: result.issues, key });
      }

      return issues.length > 0 ? { ok: false, issues } : ok(output);
    },
    json: { type: "object", additionalProperties: value.json }
  });

export const optional = <T>(schema: Schema<T>): Schema<T | undefined> =>
  defineSchema({
    check: (input) => (input === undefined ? ok(undefined) : schema.check(input)),
    json: schema.json,
    is_optional: true
  });

export const nullable = <T>(schema: Schema<T>): Schema<T | null> =>
  defineSchema({
    check: (input) => (input === null ? ok(null) : schema.check(input)),
    json: { anyOf: [schema.json, { type: "null" }] }
  });

/** First schema that accepts the input wins; with none, the issues of the first one are reported. */
export const union = <const T extends readonly Schema<unknown>[]>(schemas: T): Schema<Infer<T[number]>> =>
  defineSchema({
    check: (input) => {
      let first: CheckResult<unknown> | null = null;

      for (const schema of schemas) {
        const result = schema.check(input);

        // Cast: the accepting member's output is one of the union's members.
        if (result.ok) return result as CheckResult<Infer<T[number]>>;

        first ??= result;
      }

      return first && !first.ok ? first : fail(DEFAULT_MESSAGES.type);
    },
    json: { anyOf: schemas.map((schema) => schema.json) }
  });

export const unknown = (): Schema<unknown> => defineSchema({ check: ok, json: {} });

type RefineInput<T> = {
  schema: Schema<T>;
  check: (value: T) => boolean;
  message: string;
  /** Pins the issue on a field, e.g. `["confirm_password"]` for a cross-field rule on an object. */
  path?: PropertyKey[];
};

/** Extra rule over an already valid value; runs only when `schema` itself passed (JSON Schema can't express it). */
export const refine = <T>({ schema, check, message, path }: RefineInput<T>): Schema<T> =>
  defineSchema({
    check: (input) => {
      const result = schema.check(input);

      if (!result.ok || check(result.value)) return result;

      return { ok: false, issues: [{ message, path: path ?? [] }] };
    },
    json: schema.json,
    is_optional: schema.is_optional
  });

type TransformInput<T, U> = { schema: Schema<T>; map: (value: T) => U };

/** Reshapes an already valid value (defaults, stripping); `map` must not throw, the model sees `schema`'s JSON. */
export const transform = <T, U>({ schema, map }: TransformInput<T, U>): Schema<U> =>
  defineSchema({
    check: (input) => {
      const result = schema.check(input);

      return result.ok ? ok(map(result.value)) : result;
    },
    json: schema.json,
    is_optional: schema.is_optional
  });

/** Same schema with a `description` for LLM tool / structured-output consumers (zod's `.describe`). */
export const withDescription = <T>(schema: Schema<T>, description: string): Schema<T> =>
  defineSchema({
    check: schema.check,
    json: { ...schema.json, description },
    is_optional: schema.is_optional
  });

/** The schema as JSON Schema for LLM tools / structured output; pair it with `check` for the actual validation. */
export const toJsonSchema = (schema: Schema<unknown>): JsonSchema => schema.json;
