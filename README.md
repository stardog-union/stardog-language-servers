# Stardog Language Servers

Standalone, IDE-agnostic language servers for [Stardog](https://www.stardog.com)
languages, including [SPARQL](https://en.wikipedia.org/wiki/SPARQL),
[Turtle](https://en.wikipedia.org/wiki/Turtle_(syntax)), and
[Stardog Mapping Syntax 2 (SMS)](https://www.stardog.com/docs/#_stardog_mapping_syntax_2).

This work is the basis of [Stardog Studio](http://stardog.com/studio), the Knowledge Graph IDE for Stardog.

## Features

- Support for all transports specified in the [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) 
(IPC, stdio, sockets, pipes)
- Additional support for running purely in the browser using web workers as a
transport (no need for sockets or other transports)
- Support for W3C-standard SPARQL and Turtle, as well as Stardog SPARQL
extensions and Stardog Mapping Syntax 2 (SMS) (with additional languages coming
soon!)
- Compatible with any IDE or editor capable of working with LSP-compliant
language servers
- LSP features currently supported include:
  - Hovers
  - Completion
  - Diagnostics

## Try it Out

You can try these language servers out in [Visual Studio Code](https://code.visualstudio.com/),
using our [Visual Studio Code Extension](TODO).

## Integrating with Other Editors

Different editors support language servers in different ways. [Neovim], for
example, requires that you install [LanguageClient-neovim](https://github.com/autozimu/LanguageClient-neovim),
install the language server on your system, and then edit your Neovim
configuration file (`init.vim`) to register the server for the relevant
language. This means that, for many editors, you will likely have to do a small
amount of searching (to find out whether/how your editor supports language
servers) and tinkering (editing of configuration files). Typically, you will
at least want to install the language server of your choice on your system,
using either `npm install -g <language-server-of-your-choice-here>` or
`yarn global add <language-server-of-your-choice-here>`.

### Example: Integrating with Neovim

Just to provide a quick example, here is how you can integrate our SPARQL
language server with Neovim (these instructions assume you already have
Neovim itself installed):

1. Install [LanguageClient-neovim](https://github.com/autozimu/LanguageClient-neovim).
2. Install the SPARQL language server on your system using either npm or yarn,
i.e., `npm install -g sparql-language-server` or `yarn global add sparql-language-server`.
3. Add the following lines to your Neovim configuration file (named 'init.vim',
and typically located at `~/.config/nvim/init.vim` on Linux/MacOS and
`~/AppData/Local/nvim/init.vim` on Windows):

```
" Tell Neovim to set the filetype to 'sparql' for .sparql and .rq
au BufRead,BufNewFile *.{sparql,rq}   setfiletype sparql

" Tell Neovim to use the sparql-language-server for sparql files
let g:LanguageClient_serverCommands = {
    \ 'sparql': ['sparql-language-server', '--stdio'],
    \ }
```

For Neovim specifically, a more detailed explanation is [here](https://fortes.com/2017/language-server-neovim/);
the explanation covers a _JavaScript_ language server, but the same general
steps apply for any language server. Integration with other editors/IDEs will
follow the same general pattern.

Note that you can also manually start-up the relevant language server (after
installing it on your system) using Node, by running:

```
node path/to/installed/language-server/dist/cli.js [--stdio|--node-ipc|--pipe|--socket=[port]]
```

## Developing/Contributing

The Stardog language servers are maintained in a monorepo using
[lerna](https://lernajs.io/) and [yarn workspaces](https://yarnpkg.com/lang/en/docs/workspaces/).
After cloning the repo, you can run `yarn` in the root of the monorepo in order
to install all dependencies for all packages. At that point, building is a
matter of running:

```
yarn build
```

You can similarly run tests by running:

```
yarn test
```

These commands can also be run in the sub-directories for individual language
servers, if you would like to focus only on a particular one while developing.

When making changes, please branch off of `master` (in a fork of this repo, if
you are not a team member), then push a PR back to `master` when you believe
that your changes are ready.

All code should be written in [TypeScript](https://www.typescriptlang.org/).
Feel free to use any ES2015+ syntax, but steer clear of any ES2015+ environment
changes that would require polyfilling (e.g., `Set` or `Array.from`).

Code style mostly doesn't matter, as long as your code passes the linter. We
use `prettier` at commit-time to auto-format all code to our preferred style.

## License

Apache-2.0
