import assert from "assert";
import { identifier, list, sql, template, unsafe } from "./index";

describe("sql", () => {
  it("should do simple variable substitution", () => {
    const query = sql`
      SELECT * FROM accounts WHERE id = ${12345}
    `;

    assert.deepStrictEqual(query, {
      text: "SELECT * FROM accounts WHERE id = $1",
      values: [12345],
    });
  });

  it("should allow functions to do more complex substitution", () => {
    const query = sql`
      SELECT * FROM accounts WHERE id = ${(sql) => sql`ANY(${123}, ${456})`}
    `;

    assert.deepStrictEqual(query, {
      text: "SELECT * FROM accounts WHERE id = ANY($1, $2)",
      values: [123, 456],
    });
  });

  it("should allow identifiers", () => {
    const query = sql`
      SELECT * FROM ${identifier("accounts")} WHERE id = 123
    `;

    assert.deepStrictEqual(query, {
      text: 'SELECT * FROM "accounts" WHERE id = 123',
      values: [],
    });

    //                                ↙ note attempt to break out of quoting
    const injectionValue = 'accounts " --';
    const injection = sql`
      SELECT * FROM ${identifier(injectionValue)} WHERE id = 123`;

    assert.deepStrictEqual(injection, {
      text: 'SELECT * FROM "accounts "" --" WHERE id = 123',
      values: [],
    });
  });

  it("should allow templates", () => {
    const tmpl = template`archived_at IS NULL`;
    const query = sql`SELECT * FROM accounts WHERE ${tmpl}`;

    assert.deepStrictEqual(query, {
      text: "SELECT * FROM accounts WHERE archived_at IS NULL",
      values: [],
    });
  });
  it("should allow lists", () => {
    const query = sql`
      SELECT * FROM accounts WHERE id = ANY(${list([123, 456])})
    `;

    assert.deepStrictEqual(query, {
      text: "SELECT * FROM accounts WHERE id = ANY($1, $2)",
      values: [123, 456],
    });

    const conditions = [
      template`id = ${123}`,
      template`archived_at IS NULL`,
      template`name ILIKE ${"turbine%"}`,
    ];
    const predicates = sql`
      SELECT * FROM accounts WHERE ${list(conditions, " AND ")}`;

    assert.deepStrictEqual(predicates, {
      text:
        "SELECT * FROM accounts WHERE id = $1 AND archived_at IS NULL AND name ILIKE $2",
      values: [123, "turbine%"],
    });
  });
  it("should allow unsafe values :(", () => {
    const query = sql`
      SELECT * FROM accounts WHERE id = ${unsafe("'12345'")}
    `;

    assert.deepStrictEqual(query, {
      text: "SELECT * FROM accounts WHERE id = '12345'",
      values: [],
    });
  });
});
