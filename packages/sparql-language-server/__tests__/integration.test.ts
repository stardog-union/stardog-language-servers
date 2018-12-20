import { join, resolve } from 'path';
import {
  testInitHandshakeForAllTransports,
  getStdioConnection,
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
  CompletionRequest,
} from 'vscode-languageserver-protocol';
import { ChildProcess } from 'child_process';

const server = resolve(join(__dirname, '..', 'src', 'cli.ts'));

testInitHandshakeForAllTransports(server);

describe('sparql capabilities', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  const textDocument = TextDocumentItem.create(
    '/foo.rq',
    'sparql',
    1,
    'select * { ?a ?b ?c '
  );
  beforeAll(async () => {
    const processAndConn = getStdioConnection(server);
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
          source: 'GroupGraphPattern',
          severity: 1,
          range: {
            start: {
              line: 0,
              character: 20,
            },
            end: {
              line: 0,
              character: 20,
            },
          },
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
    expect(res.contents).toBe('```\nSelectClause\n```');
    done();
  });
  it('publishes autocompletion items', async (done) => {
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument,
      position: Position.create(0, 3),
    });
    expect(res).toHaveLength(25);
    expect(res[0]).toMatchObject({
      label: '?a',
      kind: 6,
      sortText: null,
      textEdit: {
        range: {
          start: {
            line: 0,
            character: 0,
          },
          end: {
            line: 0,
            character: 6,
          },
        },
        newText: '?a',
      },
    });
    done();
  });
});
