import { spawn, ChildProcess } from 'child_process';
import {
  StreamMessageReader,
  StreamMessageWriter,
  IPCMessageReader,
  IPCMessageWriter,
  createClientSocketTransport,
  createClientPipeTransport,
  generateRandomPipeName,
} from 'vscode-jsonrpc';
import {
  InitializeRequest,
  createProtocolConnection,
  ProtocolConnection,
} from 'vscode-languageserver-protocol';
import * as portscanner from 'portscanner';

export const testInitHandshake = (
  connection: ProtocolConnection,
  done: jest.DoneCallback
) => {
  connection.listen();
  connection
    .sendRequest(InitializeRequest.type, {
      capabilities: {},
      processId: process.pid,
      rootUri: '/',
      workspaceFolders: null,
    })
    .then((res) => {
      expect(res).toHaveProperty('capabilities');
      done();
    });
};

export const testInitHandshakeForAllTransports = (pathToServer: string) =>
  describe(pathToServer, () => {
    let cp: ChildProcess;
    afterEach(() => cp.kill());
    it('performs LSP initialization via stdio', (done) => {
      cp = spawn('ts-node', [
        '--compilerOptions',
        JSON.stringify({ module: 'commonjs' }),
        pathToServer,
        '--stdio',
      ]);
      const connection = createProtocolConnection(
        new StreamMessageReader(cp.stdout),
        new StreamMessageWriter(cp.stdin),
        null
      );
      testInitHandshake(connection, done);
    });
    it('performs LSP initialization via IPC', (done) => {
      cp = spawn(
        'ts-node',
        [
          '--compilerOptions',
          JSON.stringify({ module: 'commonjs' }),
          pathToServer,
          '--node-ipc',
        ],
        {
          stdio: [null, null, null, 'ipc'],
        }
      );
      const connection = createProtocolConnection(
        new IPCMessageReader(cp),
        new IPCMessageWriter(cp),
        null
      );
      testInitHandshake(connection, done);
    });
    it('performs LSP initialization via socket', async (done) => {
      const portFloor = Math.floor(Math.random() * 1000 + 2000);
      const PORT = await portscanner.findAPortNotInUse(
        portFloor,
        portFloor + 5000
      );
      cp = spawn('ts-node', [
        '--compilerOptions',
        JSON.stringify({ module: 'commonjs' }),
        pathToServer,
        `--socket=${PORT}`,
      ]);
      createClientSocketTransport(PORT).then((socketTransport) =>
        socketTransport.onConnected().then(([messageReader, messageWriter]) => {
          const connection = createProtocolConnection(
            messageReader,
            messageWriter,
            null
          );
          testInitHandshake(connection, done);
        })
      );
    });
    it('performs LSP initialization via pipe', (done) => {
      const pipeName = generateRandomPipeName();
      cp = spawn('ts-node', [
        '--compilerOptions',
        JSON.stringify({ module: 'commonjs' }),
        pathToServer,
        `--pipe=${pipeName}`,
      ]);
      createClientPipeTransport(pipeName).then((pipeTransport) =>
        pipeTransport.onConnected().then(([messageReader, messageWriter]) => {
          const connection = createProtocolConnection(
            messageReader,
            messageWriter,
            null
          );
          testInitHandshake(connection, done);
        })
      );
    });
  });
