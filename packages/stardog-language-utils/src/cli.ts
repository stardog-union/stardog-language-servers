export * from './common';
import * as yargs from 'yargs';
import { createConnection, IConnection } from 'vscode-languageserver';
import {
  IPCMessageReader,
  IPCMessageWriter,
  createServerSocketTransport,
  createServerPipeTransport,
} from 'vscode-jsonrpc';

enum LspTransportMethod {
  IPC = 'node-ipc',
  STDIO = 'stdio',
  SOCKET = 'socket',
  PIPE = 'pipe',
}

const methodNames = Object.keys(LspTransportMethod).map(
  (methodKey) => LspTransportMethod[methodKey]
);

const connectionGetters = {
  [LspTransportMethod.IPC]: () =>
    createConnection(
      new IPCMessageReader(process),
      new IPCMessageWriter(process)
    ),
  [LspTransportMethod.STDIO]: () =>
    createConnection(process.stdin, process.stdout),
  [LspTransportMethod.SOCKET]: (port: string) => {
    const [reader, writer] = createServerSocketTransport(parseInt(port, 10));
    return createConnection(reader, writer);
  },
  [LspTransportMethod.PIPE]: (pipeName: string) => {
    const [reader, writer] = createServerPipeTransport(pipeName);
    return createConnection(reader, writer);
  },
};

export const getCliConnection = (language: string): IConnection => {
  const handleError = (message: string) => {
    console.error(`ERROR: ${message}\n`);
    cli.showHelp();
    process.exit(1);
  };

  const cli = yargs
    .usage(
      `${language} Language Service Command-Line Interface.\nUsage: $0 [args]`
    )
    .help('h')
    .alias('h', 'help')
    .option(LspTransportMethod.IPC, {
      describe: `Use ${
        LspTransportMethod.IPC
      } to communicate with the server. Useful for calling from a node.js client`,
    })
    .option(LspTransportMethod.STDIO, {
      describe: `Use ${
        LspTransportMethod.STDIO
      } to communicate with the server`,
    })
    .option(LspTransportMethod.PIPE, {
      describe: `Use a ${
        LspTransportMethod.PIPE
      } (with a name like --pipe=/tmp/named-pipe) to communicate with the server`,
      type: 'string',
    })
    .option(LspTransportMethod.SOCKET, {
      describe: `Use a ${
        LspTransportMethod.SOCKET
      } (with a port number like --socket=5051) to communicate with the server`,
      type: 'number',
    });

  const { argv } = cli;
  const methods = methodNames.filter((methodName) => Boolean(argv[methodName]));

  if (methods.length !== 1) {
    handleError(
      `${language} Language Service requires exactly one connection method (${methodNames.join(
        ', '
      )})`
    );
  }

  const method = methods[0];

  switch (method) {
    case LspTransportMethod.SOCKET:
      if (!argv.socket) {
        handleError('--socket option requires a port.');
      }
      return connectionGetters[LspTransportMethod.SOCKET](argv.socket);
    case LspTransportMethod.PIPE:
      if (!argv.pipe) {
        handleError('--pipe option requires a pipe name.');
      }
      return connectionGetters[LspTransportMethod.PIPE](argv.pipe);
    default:
      return connectionGetters[method]();
  }
};
