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
  CompletionItem,
} from 'vscode-languageserver-protocol';
import { ChildProcess } from 'child_process';

const pathToServer = resolve(join(__dirname, '..', 'src', 'cli.ts'));
const initParams = {
  capabilities: {},
  processId: process.pid,
  rootUri: '/',
  workspaceFolders: null,
};

const selectTextDoc = TextDocumentItem.create(
  '/foo.rq',
  'sparql',
  1,
  'select * { ?a ?b ?c '
);
const pathsTextDoc = TextDocumentItem.create(
  '/paths.rq',
  'sparql',
  1,
  'paths st'
);

testInitHandshakeForAllTransports(pathToServer);
testShutdown(pathToServer);

describe('sparql language server', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  beforeAll(async () => {
    const processAndConn = getStdioConnection(pathToServer);
    connection = processAndConn.connection;
    cp = processAndConn.child_process;

    connection.listen();
    await connection.sendRequest(InitializeRequest.type, initParams);
    await connection.sendNotification(InitializedNotification.type);
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: selectTextDoc,
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
      connection.onNotification(PublishDiagnosticsNotification.type, () => {});
      done();
    });
  });
  it('publishes hover messages', async (done) => {
    const res = await connection.sendRequest(HoverRequest.type, {
      textDocument: selectTextDoc,
      position: Position.create(0, 3),
    });
    expect(res.contents).toBe('```\nSelectClause\n```');
    done();
  });
  it('publishes autocompletion items', async (done) => {
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument: selectTextDoc,
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
  it('handles stardog-specific grammar', async (done) => {
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: pathsTextDoc,
    });
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument: pathsTextDoc,
      position: Position.create(0, 5),
    });
    expect(
      (res as CompletionItem[]).some((item) => item.label === 'paths shortest')
    ).toBe(true);
    done();
  });
});

describe('w3 sparql language server', () => {
  let cp: ChildProcess;
  let connection: ProtocolConnection;
  beforeAll(async () => {
    const processAndConn = getStdioConnection(pathToServer);
    cp = processAndConn.child_process;

    connection = processAndConn.connection;
    connection.listen();

    await connection.sendRequest(InitializeRequest.type, {
      ...initParams,
      initializationOptions: {
        grammar: 'w3',
      },
    });
    await connection.sendNotification(InitializedNotification.type);
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: pathsTextDoc,
    });
  });
  afterAll(() => cp.kill());
  it('initializes a W3SparqlParser', async (done) => {
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: pathsTextDoc,
    });
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument: pathsTextDoc,
      position: Position.create(0, 5),
    });
    expect(
      (res as CompletionItem[]).some((item) => item.label === 'paths shortest')
    ).toBe(false);
    done();
  });
});
