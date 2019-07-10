import { join, resolve } from 'path';
import {
  testInitHandshakeForAllTransports,
  getStdioConnection,
  testShutdown,
} from '../../../utils/testUtils';
import {
  InitializeRequest,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  TextDocumentItem,
  PublishDiagnosticsNotification,
  ProtocolConnection,
  HoverRequest,
  Position,
} from 'vscode-languageserver-protocol';
import { ChildProcess } from 'child_process';

const pathToServer = resolve(join(__dirname, '..', 'src', 'cli.ts'));

testInitHandshakeForAllTransports(pathToServer);
testShutdown(pathToServer);

describe('GraphQL language server', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  const textDocument = TextDocumentItem.create(
    '/foo.graphql',
    'graphql',
    1,
    '{ Human { name'
  );
  beforeAll(async () => {
    const processAndConn = getStdioConnection(pathToServer);
    connection = processAndConn.connection;
    cp = processAndConn.child_process;

    connection.listen();
    await connection.sendRequest(InitializeRequest.type, {
      capabilities: {},
      processId: process.pid,
      rootUri: '/',
      workspaceFolders: null,
    });
    await connection.sendNotification(InitializedNotification.type);
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument,
    });
  });
  afterAll(() => {
    cp.kill();
  });
  it('publishes diagnostics', async (done) => {
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      expect(params.diagnostics).toMatchObject([
        {
          message: "'}' expected.",
          range: {
            end: { character: 14, line: 0 },
            start: { character: 14, line: 0 },
          },
          severity: 1,
          source: 'SelectionSet',
        },
      ]);
      done();
    });
  });
  it('publishes hover messages', async (done) => {
    const res = await connection.sendRequest(HoverRequest.type, {
      textDocument,
      position: Position.create(0, 3),
    });
    expect(res.contents).toBe('```\nField\n```');
    done();
  });
});
