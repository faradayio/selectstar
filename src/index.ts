interface Output {
  text: string;
  values: unknown[];
}

// Ported from <https://github.com/brianc/node-postgres/blob/3f6760c62ee2a901d374b5e50c2f025b7d550315/packages/pg/lib/client.js#L408-L437>
function escapeIdentifier(str: string): string {
  return '"' + str.replace(/"/g, '""') + '"';
}

// Ported from <https://github.com/brianc/node-postgres/blob/3f6760c62ee2a901d374b5e50c2f025b7d550315/packages/pg/lib/client.js#L408-L437>
function escapeLiteral(str: string): string {
  var hasBackslash = false;
  var escaped = "'";

  for (var i = 0; i < str.length; i++) {
    var c = str[i];
    if (c === "'") {
      escaped += c + c;
    } else if (c === "\\") {
      escaped += c + c;
      hasBackslash = true;
    } else {
      escaped += c;
    }
  }

  escaped += "'";

  if (hasBackslash === true) {
    escaped = " E" + escaped;
  }

  return escaped;
}

const $$BOX$$ = Symbol("$$SQL.BOX$$");
interface Box<T = Record<string, unknown>> {
  [$$BOX$$]: T;
}
function box<T>(value: T): Box<T> {
  return { [$$BOX$$]: value };
}
function unwrap<T>(value: Box<T>): T {
  if (!isBox(value)) throw new TypeError("Unexpected non-box value");
  return value[$$BOX$$];
}
function isBox(value: unknown): value is Box {
  return value && typeof value === "object" && $$BOX$$ in value;
}

type Identifier = Box<{ type: "identifier"; value: string }>;
function isIdentifier(value: unknown): value is Identifier {
  return isBox(value) && unwrap(value).type === "identifier";
}
export function identifier(value: string): Identifier {
  return box({ type: "identifier", value });
}

type List = Box<{ type: "list"; items: unknown[]; separator: string }>;
function isList(value: unknown): value is List {
  return isBox(value) && unwrap(value).type === "list";
}
export function list(items: unknown[], separator: string = ", "): List {
  return box({ type: "list", items, separator });
}

type Literal = Box<{ type: "literal"; value: string }>;
function isLiteral(value: unknown): value is Literal {
  return isBox(value) && unwrap(value).type === "literal";
}
export function literal(value: string): Literal {
  return box({ type: "literal", value });
}

type Unsafe = Box<{ type: "unsafe"; value: unknown }>;
function isUnsafe(value: unknown): value is Unsafe {
  return isBox(value) && unwrap(value).type === "unsafe";
}
export function unsafe(value: unknown): Unsafe {
  return box({ type: "unsafe", value });
}

function subsql(fragments: TemplateStringsArray, ...params: unknown[]) {
  return { fragments, params };
}

function process(
  fragments: TemplateStringsArray,
  params: unknown[],
  index: number = 1
): Output {
  let text = "";
  let values: unknown[] = [];

  function processParam(param: unknown) {
    if (typeof param === "function") {
      const result = param(subsql);

      if ("fragments" in result && "params" in result) {
        // The result of the inner function is the result of a call to `subsql`
        const processed = process(result.fragments, result.params, index);

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
    } else if (isLiteral(param)) {
      // Allows adding escaped literals to a query safely. For example:
      //
      // sql`SELECT * FROM tbl WHERE name = ${literal("example")}`
      //
      // would result in:
      //
      // `SELECT * FROM tbl WHERE name = 'example'`
      //
      // Note that this bypasses the standard node-pg parameterization/
      text += escapeLiteral(unwrap(param).value);
    } else if (isUnsafe(param)) {
      // Unsafely add this string to a query. Bypasses parameterization and
      // any sort of escaping. It's called Unsafe for a reason, because it turns
      // all the safeties off.
      text += unwrap(param).value;
    } else {
      text += "$" + index;
      values.push(param);
      index += 1;
    }
  }

  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i];

    text += fragment;

    // We are on the last iteration, which means there should be no more params
    // to process. If there are, throw an error. If there are not, skip the rest
    // of this loop iteration.
    if (i === fragments.length - 1) {
      if (params[i]) {
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

export function format(sql: string): string {
  const pieces = sql.split("\n").filter((p) => !p.match(/^\s*$/));
  const leadingSpace = Math.min(
    ...pieces.map((p) => p.length - p.trimStart().length)
  );

  return pieces.map((p) => p.slice(leadingSpace)).join("\n");
}

type SqlTemplateStringParams =
  | string
  | number
  | Identifier
  | List
  | Literal
  | Unsafe
  | ((subsql: typeof sql) => Output);

/**
 * Using a template literal, generate a query with arguments that can be passed
 * to node-pg safely.
 *
 * @param fragments
 * @param args
 * @return {{query: *, values: *}}
 */
export function sql(
  fragments: TemplateStringsArray,
  ...args: SqlTemplateStringParams[]
): Output {
  if (!Array.isArray(fragments))
    throw new TypeError(`Unexpected value ${typeof fragments} at arg 0`);

  const { text, values } = process(fragments, args);

  return {
    text: format(text),
    values,
  };
}

export type Template = (subsql: typeof sql) => Output;

/**
 * Generate a template that can be used in a query generated by the sql function
 * declared above.
 *
 * @param fragments
 * @param args
 */
export function template(
  fragments: TemplateStringsArray,
  ...args: SqlTemplateStringParams[]
): Template {
  if (!Array.isArray(fragments))
    throw new TypeError(`Unexpected value ${typeof fragments} at arg 0`);

  return function tmpl(subsql: typeof sql) {
    return subsql(fragments, ...args);
  };
}
