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
import { ModeString } from 'millan';

const pathToServer = resolve(join(__dirname, '..', 'src', 'cli.ts'));

testInitHandshakeForAllTransports(pathToServer);
testShutdown(pathToServer);

describe('turtle language server', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  const textDocument = TextDocumentItem.create(
    '/foo.rq',
    'turtle',
    1,
    '<someIri> <anotherIri> <partOfAnIri'
  );
  const textDocumentWithEdgeProperties = TextDocumentItem.create(
    '/foo-edge.rq',
    'turtle',
    1,
    '<< :something a :Something >> a :Statement'
  );

  const setup = async (mode: ModeString = 'standard') => {
    const processAndConn = getStdioConnection(pathToServer);
    connection = processAndConn.connection;
    cp = processAndConn.child_process;

    connection.listen();
    await connection.sendRequest(InitializeRequest.type, {
      capabilities: {},
      processId: process.pid,
      rootUri: '/',
      workspaceFolders: null,
      initializationOptions: {
        mode,
      },
    });
    await connection.sendNotification(InitializedNotification.type);
    return connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument,
    });
  };

  afterAll(() => {
    cp.kill();
  });

  it('publishes diagnostics', async (done) => {
    await setup();
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      expect(params.diagnostics).toMatchObject([
        {
          message:
            "\tExpected one of the following:\n IRIREF\n PNAME_LN\n PNAME_NS\n BLANK_NODE_LABEL\n ANON e.g. []\n '('\n '['\n STRING_LITERAL_QUOTE\n STRING_LITERAL_SINGLE_QUOTE\n STRING_LITERAL_LONG_SINGLE_QUOTE\n STRING_LITERAL_LONG_QUOTE\n INTEGER\n DECIMAL\n DOUBLE\n 'true'\n 'false'\n '{'",
          source: 'predicateObjectList',
          severity: 1,
          range: {
            start: {
              line: 0,
              character: 23,
            },
            end: {
              line: 0,
              character: 24,
            },
          },
        },
      ]);
      done();
    });
  });

  it('publishes hover messages', async () => {
    await setup();
    const res = await connection.sendRequest(HoverRequest.type, {
      textDocument,
      position: Position.create(0, 3),
    });
    expect(res.contents).toBe('```\niri\n```');
  });

  it("can operate in 'stardog' mode", async () => {
    await setup('stardog');
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: textDocumentWithEdgeProperties,
    });
    const res = await connection.sendRequest(HoverRequest.type, {
      textDocument: textDocumentWithEdgeProperties,
      position: Position.create(0, 1),
    });
    expect(res.contents).toBe('```\nEmbeddedTriplePattern\n```');
  });
});
