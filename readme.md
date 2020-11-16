# selectstar

Safe, idiomatic query generation for Postgres.

## Installation

```
npm install selectstar
```

## Usage

`selectstar` is a library for generating sophisticated SQL within a Javascript
or TypeScript program, while still making it easy to avoid SQL injection
attacks and other common mistakes when generating queries with string
concatenation.

```js
import { sql } from 'selectstar';

sql`SELECT 1`;
```

`selectstar` uses [tagged template literals] to generate an object that you can
pass to node-postgres as a [parameterized query]. Above, we are generating the
simplest possible Postgres query, and it results in a simple object of two keys:

```js
{
  text: 'SELECT 1',
  values: []
}
``` 

You can pass this directly into the `.query` methods of `pg`'s `Client` and
`Pool` instances:

```js
await client.query(sql`SELECT 1`)
```

### Parameters

If you pass templated variables into the query, they will appear in the
resulting object as query parameters:

```js
const id = 802728;

sql`
  SELECT id, first_name, last_name
  FROM users
  WHERE id = ${id}
`;
// returns:
{
  text: `
    SELECT id, first_name, last_name
    FROM users
    WHERE id = $1
  `,
  values: [802728]
}
```

This introduces a layer of safety, because query parameters can't be used for
sql injection attacks. You can insert any value into the template that Postgres
supports, which includes strings, numbers, arrays, objects, and dates.

`selectstar` is ignorant of the underlying query semantics, which means that it
will handle more sophisticated Postgres queries gracefully as well:

```js
// use a CTE, selectstar doesn't care:
const query = sql`
  WITH place_ids (id) AS (
    SELECT p1.id
    FROM places AS p1
    JOIN places AS p2 ON p2.id = ${place_id}
    WHERE
      ST_Intersects(p1.the_geom, p2.the_geom)
  )
  SELECT * FROM places JOIN place_ids ON place_ids.id = places.id
`;
```

### Templating (or: Dynamic Queries)

Sometimes you will want to generate a query that has a dynamic number of
variables, or optionally includes snippets. `selectstar` offers some tools to
make this easy and safe.

#### Use `template` to construct query fragments:

The `template` function will create a snippet of SQL that can be inserted into
larger queries. These templates can contain variables, which will be lazily
evaluated when the query is constructed:

```js
import { subDays } from 'date-fns';
import { sql, template } from 'selectstar';

const yesterday = subDays(new Date(), 1); // subtract 1 day from today
const updatedSinceYesterday = template`updated_at > ${yesterday}`;

const query = sql`SELECT * FROM users WHERE ${updatedSinceYesterday}`;
// query =
{
  text: `SELECT * FROM users WHERE updated_at > $1`.
  values: [yesterday]
}
```

#### Use `identifier` to dynamically-specify column or table names:

The `identifier` function will let you safely specify constants inline within a
query in places where parameters can't be used or are undesirable. Identifiers
are escaped using the same algorithm as node-postgres. There are two main uses
for `identifier`: specifying dynamic columns or dynamic table names:

```js
const vesselType = "submarines"; // or "spaceships", or "sailboats", etc
const query = `SELECT id, name FROM ${identifier(vesselType)}`;
// query =
{
  text: `SELECT id, name FROM "submarines"`,
  values: []
}
```

#### Use `list` to generate lists of dynamic SQL:

The `list` function will let you transform a list of data into dynamic SQL. This
combines well with the previous functions:

```js
const rows = [
  { id: 1, first: "Phillip", last: "Fry" },
  { id: 2, first: "Turanga", last: "Leela" },
];

const rowSql = ({ id, first, last }) =>
  template`(${id}, ${first}, ${last}, now())`;

const query = `
  INSERT INTO users (id, first_name, last_name, created_at) VALUES
  ${list(rows.map(rowSql))}
`;
// query =
{
  text: `
    INSERT INTO users (id, first_name, last_name, created_at) VALUES
    ($1, $2, $3, now()),
    ($4, $5, $6, now())
  `
}
```

The default separator for `list` is the literal string `", "`. You can change
this by passing a different separator as the second argument:

```js
const criteria = [
  template`updated_at > ${yesterday}`,
  template`home_town = ${hometown}`
];

const query = `
  SELECT * FROM users WHERE
  ${list(criteria, ' AND ')}
`
// query =
{
  text: `
    SELECT * FROM users WHERE
    updated_at > $1 AND home_town = $2
  `,
  values: [yesterday, hometown]
}
```

**Beware:** Do not pass dynamic or potentially-unsafe values to `separator`.
Values passed to this function are treated as literal safe values. Recommend
that you only pass `", "`, `" AND "`, and `" OR "` to this second argument. The
default is `", "`, which is appropriate in most circumstances.

#### Use a function as an escape hatch

You may need to do something that isn't covered by the tools above, but you
still need the safety of parameterized queries. In this case, you can pass a
function to a parameter, and it will be evaluated when the query is generated.

The function takes a single argument: an entrypoint that lets you generate
dynamic SQL. Under the hood this is how the `template` function works.

```js
function columns(sql) {
  const cols = ['id', 'name', 'speed'];
  return sql`${list(cols.map(identifier))}`;
}

const query = `SELECT ${columns} FROM starships`;
// query =
{
  text: `SELECT "id", "name", "speed" FROM starships`,
  values: []
}
```

#### Use `unsafe` if you have no other choice

Sometimes you need to turn all the safeties off. In this case you can use the
`unsafe` function to insert literal SQL into your queries. `unsafe` takes a
string, which will be inserted wholesale into the resulting query. Use at your
own risk, `selectstar` cannot help you if you screw up.

```js
const columns = ['id', 'name', 'speed'];
const query = `SELECT ${unsafe(columns.join(', '))} FROM starships`;
// query =
{
  text: `SELECT id, name, speed FROM starships`,
  values: []
}
```

### Streaming

`selectstar` is agnostic about how you use the generated query. As a result you
can use the result in some interesting ways. For example, the [pg-query-stream]
library allows you to pull records out of the database through a Nodejs readable
object stream. This lets you perform streaming transformations on large numbers
of records as they are pulled from the database without requiring a ton of
memory.

```js
import QueryStream from 'pg-query-stream';
import { sql } from 'selectstar';

const query = `SELECT id, first_name, last_name FROM users`;
const stream = new QueryStream(query.text, query.values);
await db.query(stream);

// In Node, readable streams are also async iterators, which we can loop over
// with `for await (...`
for await (const user of stream) {
  console.log(`[${user.id}]  ${user.first_name} ${user.last_name}`);
}
// Logs:
// [1]  Phillip Fry
// [2]  Turanga Leela
// ...
```

This is especially useful if you want to do an [ETL] process where you're
querying data out of a database to be stored in another format or in a different
DBMS. This pairs ideally with the [naushon] stream transformation library, which
is used in the example below:

```js
import { eduction, partitionBy } from 'naushon';

const query = `SELECT * FROM vessels`;
const stream = new QueryStream(query.text, query.values);
await db.query(stream);

// Pour the results into tables based on their type using partitionBy:
for await (const vessels of eduction(partitionBy(v => v.type), stream)) {
  const vessel = vessels[0];
  const cols = Object.keys(vessel);
  const rows = vessels.map(v => template`(${list(cols.map(c => v[c]))})`);

  await db.insert(sql`
    INSERT INTO ${identifier(vessel.type)} (${list(cols.map(identifier))})
    VALUES ${list(rows)}
  `);
}
```

## Rationale

SQL is a powerful language with rich semantics. Many object-relational and
fluent query builder systems either only offer a subset of these semantics or
obscure them behind complex forms. The intention behind `selectstar` is to give
developers as thin an interface for interacting with a SQL server as possible
while still making it easy to create safe dynamic queries.

This library builds on the approach of [simple-postgres], which makes it
easier to interact with a database with no configs. Rather than combine the
concern of connecting with a database and querying the database, `selectstar`
leaves the client connection up to you. One advantage of this approach is that
`selectstar` does not have a direct dependency on postgres (it has no
dependencies at all), so you may upgrade the client library independently of
this one.

Also, because `selectstar` divorces query generation from query execution, you
may use the two in different contexts: the program or module that generates the
SQL may not know about the underlying SQL connection. You may also use
`selectstar`-generated queries with other Postgres-related libraries, like
[pg-query-stream].

`selectstar` is not a replacement for other query-generation tools like knex or
an ORM, it's another tool in the toolbox for constructing powerful, idiomatic
SQL queries.

It is possible that `selectstar` will work with different SQL clients or servers
but that is not its intended or supported use case at this time.

[tagged template literals]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals
[parameterized query]: https://node-postgres.com/features/queries#parameterized-query
[simple-postgres]: https://github.com/madd512/simple-postgres
[pg-query-stream]: https://github.com/brianc/node-postgres/tree/master/packages/pg-query-stream/
[ETL]: https://en.wikipedia.org/wiki/Extract,_transform,_load
[naushon]: https://github.com/nhusher/naushon
