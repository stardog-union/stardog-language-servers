# sparql-language-server

A server providing language intelligence (autocomplete,
diagnostics, hover tooltips, etc.) for the [SPARQL query language](https://www.stardog.com/tutorials/sparql/), including both
[W3C standard SPARQL](https://www.w3.org/TR/sparql11-query/) and [Stardog](https://www.stardog.com/) extensions (e.g., [PATHS queries](https://www.stardog.com/docs/#_path_queries)),
via the Language Server Protocol.

## Features

- Autocompletion for SPARQL keywords, including Stardog extensions
- Diagnostics (error hints)
- Hover tooltips (identifies entities in SPARQL grammar and shows "expected"
symbols in the case of an error)
- Open source
- No arbitrary code execution
- Powers some of the core language intelligence capabilities of [Stardog Studio](https://www.stardog.com/studio/)

For full details, including instructions for integrating with editors, see the
[README for the stardog-language-servers repo](https://github.com/stardog-union/stardog-language-servers/#readme).

## License

Apache-2.0