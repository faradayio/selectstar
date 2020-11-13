# selectstar

Safe, idiomatic query generation for Postgres.

## Installation

```
npm install selectstar
```

## Usage

The essential approach of selectstar is to replace any variable with a numeric
parameter that can be passed to node-postgres as a [parameterized query]. This
is the safest way to insert values into your SQL queries and should be the first
choice whenever you are performing dynamic queries against your database.

The result of the `sql` tagged literal can be passed directly to the `query`
method on many of node-postgres' objects. For example:

```js
import { sql } from 'selectstar';

async function getUserById(id) {
  const query = sql`
    SELECT id, name
    FROM users
    WHERE id = ${id}
  `;
  /* `query` becomes an object of two properties:
  {
    text: "SELECT id, name FROM users WHERE id = $1",
    values: [id]
  }
  */

  // Send the query using a node-postgres client (set up ahead of time):
  return client.query(query);
}
```

This is a fairly trivial use case, what if we want to do something more complex?
Selectstar has you covered:

```js
import { sql, identifier, list, template } from 'selectstar';

const columns = ["id", "first_name", "last_name", "created_at"];
const rows = [
  [1, "Phillip", "Fry", new Date()],
  [2, "Turanga", "Leela", new Date()],
]

const rowSql = data => template`(${list(data)})`

const insert = sql`
  INSERT INTO users (${list(columns.map(identifier))}) VALUES
  ${rows.map(rowSql)}
`
/* `insert` is an object of two properties:
{
  text: `
    INSERT INTO users ("id", "first_name", "last_name", "created_at") VALUES
    ($1, $2, $3, $4),
    ($5, $6, $7, $8)
  `,
  values: [
    1,
    "Phillip",
    "Fry",
    new Date(),
    2,
    "Turanga",
    "Leela",
    new Date()
  ]
}
*/
```

There's a lot going on here, so let's break it down a bit. The first is the
`template` function. `template` allows you to create small bits of queries that
can be assembled later, possibly in multiple queries. Any parameters or special
values you pass to `template` will be processed just as if they were passed into
the `sql` tagged literal dirctly. The only difference is that those parameters
will be processed lazily.

The `list` function generates a special value that the query processor knows
how to interpret. It will take every item you pass to `list` and process it as
if it were part of the query itself. Any parameters you pass will be treated as
query parameters. `list` takes an optional second argument for what literal
string should use to separate the members of `list`. For example:

```js
const whereClauses = [
  template`archived_at IS NULL`,
  template`account_id = ${current.account.id}`
]
const query = sql`
  SELECT * FROM users
  WHERE ${list(whereClauses, ' AND ')}
`
/*
{
  text: `
    SELECT * FROM users
    WHERE archived_at IS NULL AND account_id = $1
  `
  values: [current.account.id]
}
*/
```

**Beware:** Do not pass dynamic or potentially-unsafe values to `separator`.
Values passed to this function are treated as literal safe values. Recommend
that you only pass `", "`, `" AND "`, and `" OR "` to this second argument. The
default is `", "`, which is good in most circumstances.

Going back to the second example above, the `identifier` function allows you to
safely specify a dynamic column or table name. In this case, we map over all
the columns we want to insert and use them as identifiers.

## Rationale

This library builds on the approach of [simple-postgres], which is a library for
quickly and easily interacting with a postgres database with zero configuration
and with idiomatic query generation. This library separates out the query
generation portion of that library, and treats that problem as a first-class
concern. It extends the number of queries that can reasonably be expressed, and
migrates to TypeScript.

Generally-speaking selectstar should not be seen as a replacement for other
query-generation tools like knex or an ORM, it's another tool in the toolbox for
constructing powerful, idiomatic SQL queries. The goal of this library is to let
the user be as close to writing plain old SQL queries as possible, while also
making it easy for them to make good decisions about passing dynamic (unsafe)
data into those queries.

[parameterized query]: https://node-postgres.com/features/queries#parameterized-query
[simple-postgres]: https://github.com/madd512/simple-postgres
