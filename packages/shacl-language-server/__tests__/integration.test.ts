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

const basicShaclDoc = TextDocumentItem.create(
  '/foo.ttl',
  'shacl',
  1,
  ':TestNode1 a sh:NodeShape . :TestNode1 sh:lessThan :TestVal .'
);

testInitHandshakeForAllTransports(pathToServer);
testShutdown(pathToServer);

describe('shacl language server', () => {
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
      textDocument: basicShaclDoc,
    });
  });

  afterAll(() => {
    cp.kill();
  });

  it('publishes diagnostics', async (done) => {
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      expect(params.diagnostics).toMatchObject([
        {
          message: 'A NodeShape cannot have any value for sh:lessThan.',
          source: null,
          severity: 1,
          range: {
            start: {
              line: 0,
              character: 39
            },
            end: {
              line: 0,
              character: 50
            }
          }
        }
      ]);
      connection.onNotification(PublishDiagnosticsNotification.type, () => {});
      done();
    });
  });

  it('publishes hover messages', async (done) => {
    const res = await connection.sendRequest(HoverRequest.type, {
      textDocument: basicShaclDoc,
      position: Position.create(0, 15),
    });
    expect(res.contents).toBe('```\nshaclShapeType\n```');
    done();
  });

  it('publishes autocompletion items', async (done) => {
    const res = await connection.sendRequest(CompletionRequest.type, {
      textDocument: basicShaclDoc,
      position: Position.create(0, 40),
    });
    expect(res).toHaveLength(18);
    expect(res[0]).toMatchObject({
      label: 'sh:nodeKind',
      kind: 20,
      textEdit: {
        range: {
          start: {
            line: 0,
            character: 39,
          },
          end: {
            line: 0,
            character: 50,
          },
        },
        newText: 'sh:nodeKind',
      },
    });
    done();
  });
});
