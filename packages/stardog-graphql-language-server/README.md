# stardog-graphql-language-server

A server providing language intelligence (autocomplete,
diagnostics, hover tooltips, etc.) for [GraphQL](https://graphql.github.io/graphql-spec/), including both
standard GraphQL and [Stardog](https://www.stardog.com/) [extensions](https://www.stardog.com/docs/#_graphql_queries),
via the Language Server Protocol.

## Features

- Autocompletion for GraphQL keywords, including Stardog extensions
- Diagnostics (error hints)
- Hover tooltips (identifies entities in GraphQL grammar and shows "expected"
symbols in the case of an error)
- Open source
- No arbitrary code execution
- Powers some of the core language intelligence capabilities of [Stardog Studio](https://www.stardog.com/studio/)

For full details, including instructions for integrating with editors, see the
[README for the stardog-language-servers repo](https://github.com/stardog-union/stardog-language-servers/#readme).

## License

Apache-2.0