import { spawn, ChildProcess } from 'child_process';
import { join, resolve } from 'path';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';
import {
  InitializeRequest,
  createProtocolConnection,
} from 'vscode-languageserver-protocol';

let cp: ChildProcess;
beforeAll(() => {
  const server = resolve(join('src', 'cli.ts'));
  cp = spawn('ts-node', [
    '--compilerOptions',
    JSON.stringify({ module: 'commonjs' }),
    server,
    '--stdio',
  ]);
});
afterAll(() => {
  cp.kill();
});
describe('sparql-language-server', () => {
  it('performs LSP initialization via stdio', (done) => {
    const connection = createProtocolConnection(
      new StreamMessageReader(cp.stdout),
      new StreamMessageWriter(cp.stdin),
      null
    );
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
  });
});
