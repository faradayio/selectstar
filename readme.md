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




## Rationale

This library builds on the approach of [simple-postgres], which is a library for
quickly and easily interacting with a postgres database with zero configuration
and with idiomatic query generation.

This library separates out the query generation portion of that library, and
treats that problem as a first-class concern. It extends the number of queries
that can reasonably be expressed, and migrates to TypeScript.


[parameterized query]: https://node-postgres.com/features/queries#parameterized-query
