export interface SqlQueryObject {
  text: string;
  values: Literal[];
}

// Ported from <https://github.com/brianc/node-postgres/blob/3f6760c62ee2a901d374b5e50c2f025b7d550315/packages/pg/lib/client.js#L408-L437>
function escapeIdentifier(str: string): string {
  return '"' + str.replace(/"/g, '""') + '"';
}

/*
A "box" is just an opaque container for a value. It is deliberately difficult to
unwrap the contents of a boxed value, because once created it is intended to be
atomic and inscrutable. It is unboxed by the sql generator and processed.

A variety of box types are defined below that are used by the sql generator.
 */
const $$BOX$$ = Symbol("$$SQL.BOX$$");
interface Box<T = Record<string, unknown>> {
  [$$BOX$$]: T;
}

// Box a value, making it into an opaque atomic value.
function box<T>(value: T): Box<T> {
  return { [$$BOX$$]: value };
}
function unwrap<T>(value: Box<T>): T {
  if (!isBox(value)) throw new TypeError("Unexpected non-box value");
  return value[$$BOX$$];
}
function isBox(value: unknown): value is Box {
  return Boolean(value && typeof value === "object" && $$BOX$$ in value);
}

// An "identifier" is a value in a SQL query that refers to a table or column in
// the schema within a query. These are doublequoted and inlined when processed.
export type Identifier = Box<{ type: "identifier"; value: string }>;
function isIdentifier(value: unknown): value is Identifier {
  return isBox(value) && unwrap(value).type === "identifier";
}

/**
 * Use an identifier safely within a query. This is useful if you need to query
 * dynamic column or table names. User-provided/unsafe values should be safe to
 * pass to `identifier`; they will be escaped using the algorithm that node-pg
 * uses.
 *
 * @example
 * Imagine we have several different tables for storing vessel information. One
 * for spaceships, one for airships, one for seagoing craft, etc. We might want
 * to perform the same query against every table, depending on the type that we
 * are querying for:
 * ```
 * sql`SELECT * FROM ${identifier(vesselType)}`
 * ```
 * This will result in:
 * ```
 * {
 *   text: "SELECT * FROM "spaceships",
 *   values: []
 * }
 * ```
 *
 * @param value The dynamic string value to use as an identifier
 * @return An Identifier box
 */
export function identifier(value: string): Identifier {
  return box({ type: "identifier", value });
}

// Added for simple-postgres compatibility
export function identifiers(values: string[], separator?: string): List {
  return list(values.map(identifier), separator);
}

// A list represents an array of sql fragments that should be recursively
// processed by the sql generator.
export type List = Box<{
  type: "list";
  items: readonly SqlLiteralParams[];
  separator: string;
}>;
function isList(value: unknown): value is List {
  return isBox(value) && unwrap(value).type === "list";
}

/**
 * Generate a dynamic-length list of items in the resulting SQL query. Each item
 * in the list will be processed in order, and they will be separated by the
 * string value provided in the second argument.
 *
 * **Warning:** The separator value is treated as safe and will be included with
 * no escaping in the resulting query. Do not use dynamic values for the
 * separator argument. If you do, selectstar cannot help you.
 *
 * @example
 * ```
 * const cols = ["id", "name"]
 * const rows = [
 *   ["123", "Phillip Fry"]
 *   ["456", "Turanga Leela"]
 * ]
 * sql`
 *   INSERT INTO users (${list(columns.map(identifier))}) VALUES
 *   ${list(rows.map(cols => template`(${list(cols)})`))}
 * `
 * ```
 * This will result in:
 * ```
 * {
 *   text: `
 *     INSERT INTO users ("id", "name") VALUES
 *     ($1, $2),
 *     ($3, $4)
 *   `
 *   values: [
 *     "123",
 *     "Phillip Fry",
 *     "456",
 *     "Turanga Leela"
 *   ]
 * }
 * ```
 *
 * @param items A list of values to concatenate together in the resulting query
 * @param separator (optional) A separator to interpose between each item.
 * Default is ", "
 * @return A box containing the items in the list and a separator.
 */
export function list(
  items: readonly SqlLiteralParams[],
  separator: string = ", "
): List {
  return box({ type: "list", items, separator });
}

// Aliased for simple-postgres compatibility
export const items = list;

export type Unsafe = Box<{ type: "unsafe"; value: unknown }>;
function isUnsafe(value: unknown): value is Unsafe {
  return isBox(value) && unwrap(value).type === "unsafe";
}

/**
 * **USE WITH EXTREME CAUTION**
 *
 * If you need to include a literal value in your SQL query, and you cannot use
 * `template`, cannot use parameterization, and cannot use any other tool in
 * this toolbox, you can use `unsafe`. Values passed to unsafe are printed
 * literally in the resulting query. If you use this function with untrusted
 * data, it will eventually blow up your day. You have been warned.
 *
 * @example
 * This is not a good example because there are other, safer tools for doing
 * each part of this. Again, avoid using this function unless you have no other
 * option:
 * ```
 * sql`
 *   SELECT ${unsafe(columns.join(', '))}
 *   FROM ${unsafe(tableName)}
 *   WHERE ${unsafe(whereString)}
 * `
 * ```
 *
 * @param value
 * @return A box containing a value that will be evaluated literally in the
 * resulting query.
 */
export function unsafe(value: unknown): Unsafe {
  return box({ type: "unsafe", value });
}

export type Subsql = Box<{
  type: "subsql";
  value: { fragments: TemplateStringsArray; params: SqlLiteralParams[] };
}>;
function isSubsql(value: unknown): value is Subsql {
  return isBox(value) && unwrap(value).type === "subsql";
}

function subsql(
  fragments: TemplateStringsArray,
  ...params: [...SqlLiteralParams[]]
): Subsql {
  return box({ type: "subsql", value: { fragments, params } });
}

function isLiteral(value: unknown): value is Literal {
  const type = typeof value;
  return (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    value === null ||
    value === undefined ||
    value instanceof Date ||
    value instanceof Buffer ||
    ArrayBuffer.isView(value)
  );
}

function process(
  fragments: TemplateStringsArray,
  params: unknown[],
  index: number = 1
): SqlQueryObject {
  let text = "";
  let values: Literal[] = [];

  function processParam(param: unknown) {
    if (typeof param === "function") {
      const result = param(subsql);

      if (isSubsql(result)) {
        const { params, fragments } = unwrap(result).value;
        // The result of the inner function is the result of a call to `subsql`
        const processed = process(fragments, params, index);

        text += processed.text;
        values.push(...processed.values);
        index += processed.values.length;
      } else {
        processParam(result);
      }
    } else if (isIdentifier(param)) {
      // Allows adding escaped identifiers to a query safely. For example:
      //
      // sql`SELECT ${identifier(columnName)} FROM ${identifier(tableName)}`
      //
      // would result in:
      //
      // `SELECT "columnName" FROM "tableName"`
      text += escapeIdentifier(unwrap(param).value);
    } else if (isList(param)) {
      const { items, separator } = unwrap(param);
      for (let i = 0; i < items.length; i += 1) {
        processParam(items[i]);
        if (i !== items.length - 1) text += separator;
      }
    } else if (isUnsafe(param)) {
      // Unsafely add this string to a query. Bypasses parameterization and
      // any sort of escaping. It's called Unsafe for a reason, because it turns
      // all the safeties off.
      text += unwrap(param).value;
    } else if (isLiteral(param)) {
      text += "$" + index;
      values.push(param);
      index += 1;
    } else {
      throw new RangeError(`Value ${param} is not a valid pg literal`);
    }
  }

  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i];

    text += fragment;

    // We are on the last iteration, which means there should be no more params
    // to process. If there are, throw an error. If there are not, skip the rest
    // of this loop iteration.
    if (i === fragments.length - 1) {
      if (params.length > i) {
        // If we have more params to process, something very bad has happened.
        // Fail loudly.
        const ps = params.slice(i).join(", ");
        throw new RangeError(`Unexpected additional params: ${ps}`);
      }
      continue;
    }

    processParam(params[i]);
  }

  return { text, values };
}

/**
 * Does a very cheap "best attempt" at reformatting multiple lines of SQL into
 * something that has as little leading space as possible.
 *
 * @param sql
 */
export function format(sql: string): string {
  const pieces = sql.split("\n").filter((p) => !p.match(/^\s*$/));
  const leadingSpace = Math.min(
    ...pieces.map((p) => p.length - p.trimStart().length)
  );

  return pieces.map((p) => p.slice(leadingSpace)).join("\n");
}

export type Literal =
  // Standard literals are supported:
  | string
  | number
  | boolean
  // Per <https://github.com/brianc/node-postgres/blob/07988f985a492c85195c6cdc928f79816af94c66/packages/pg/lib/utils.js#L41>,
  // undefined and null are identical and supported.
  | null
  | undefined
  // dates are parsed as either toStringUTC or toString, depending on how pg is configured
  | Date
  // buffers and bufferviews are supported.
  | Buffer
  | ArrayBufferView;

export type Template = (fn: typeof subsql) => Subsql;
export type SqlLiteralParams =
  | Identifier
  | List
  | Unsafe
  | Template
  | Literal
  | Literal[];

/**
 * Using a template literal, generate a query with arguments that can be passed
 * to node-pg safely.
 *
 * @param fragments
 * @param args
 * @return A query object that can be passed to node-postgres's query function
 */
export function sql(
  fragments: TemplateStringsArray,
  ...args: [...SqlLiteralParams[]]
): SqlQueryObject {
  if (!Array.isArray(fragments))
    throw new TypeError(`Unexpected value ${typeof fragments} at arg 0`);

  const { text, values } = process(fragments, args);

  return {
    text: format(text),
    values,
  };
}

/**
 * Generate a template that can be used in a query generated by the sql function
 * declared above.
 *
 * @param fragments
 * @param args
 */
export function template(
  fragments: TemplateStringsArray,
  ...args: [...SqlLiteralParams[]]
): Template {
  if (!Array.isArray(fragments))
    throw new TypeError(`Unexpected value ${typeof fragments} at arg 0`);

  return (fn) => fn(fragments, ...args);
}
