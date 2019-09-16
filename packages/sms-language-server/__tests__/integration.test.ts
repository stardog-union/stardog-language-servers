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
  CompletionRequest,
} from 'vscode-languageserver-protocol';
import { ChildProcess } from 'child_process';

const pathToServer = resolve(join(__dirname, '..', 'src', 'cli.ts'));

testInitHandshakeForAllTransports(pathToServer);
testShutdown(pathToServer);

describe('sms language server', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  const textDocument = TextDocumentItem.create(
    '/foo.sms',
    'sms',
    1,
    'mapping <urn:mapping> from sql { select timeztamp'
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
  it('publishes diagnostics', (done) => {
    let called = false;
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      if (called) {
        // There doesn't appear to be a way to remove this listener without
        // disposing of the whole connection and recreating it in every test,
        // which we don't do for now.
        return;
      }
      called = true;

      expect(params.diagnostics).toMatchObject([
        {
          message: 'SqlBlock expected.',
          source: 'SqlClause',
          severity: 1,
          range: {
            start: {
              line: 0,
              character: 46,
            },
            end: {
              line: 0,
              character: 47,
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
    expect(res.contents).toBe('```\nMappingDecl\n```');
    done();
  });
  it('publishes autocompletion items', async (done) => {
    const emptyTextDocument = TextDocumentItem.create(
      '/bar.sms',
      'sms',
      1,
      'm'
    );
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: emptyTextDocument,
    });
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument: emptyTextDocument,
      position: Position.create(0, 1),
    });
    expect(res[0]).toMatchObject(
      {
        detail: 'Create a basic fill-in-the-blanks SMS2 mapping',
        documentation:
          'Inserts a basic mapping in Stardog Mapping Syntax 2 (SMS2) with tabbing functionality and content assistance. For more documentation of SMS2, check out "Help" --> "Stardog Docs".',
        insertTextFormat: 2,
        kind: 13,
        label: 'basicSMS2Mapping',
        textEdit: {
          newText:
            '# A basic SMS2 mapping.\nMAPPING$0\nFROM ${1|SQL,JSON,GRAPHQL|} {\n    $2\n}\nTO {\n    $3\n}\nWHERE {\n    $4\n}\n',
          range: {
            end: { character: 0, line: 0 },
            start: { character: 0, line: 0 },
          },
        },
      }
    );
    done();
  });
});
