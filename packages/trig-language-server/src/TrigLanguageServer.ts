import * as lsp from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  AbstractLanguageServer,
  errorMessageProvider,
} from 'stardog-language-utils';
import { TrigParser } from 'millan';

@autoBindMethods
export class TrigLanguageServer extends AbstractLanguageServer<TrigParser> {
  constructor(connection: lsp.IConnection) {
    super(connection, new TrigParser({ errorMessageProvider }));
  }

  onInitialization(_params: lsp.InitializeParams): lsp.InitializeResult {
    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        hoverProvider: true,
      },
    };
  }

  onContentChange(
    { document }: lsp.TextDocumentChangeEvent,
    parseResults: ReturnType<
      AbstractLanguageServer<TrigParser>['parseDocument']
    >
  ): void {
    const { uri } = document;
    const content = document.getText();

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: [],
      });
      return;
    }

    const { tokens, errors } = parseResults;
    const lexDiagnostics = this.getLexDiagnostics(document, tokens);
    const parseDiagnostics = this.getParseDiagnostics(document, errors);

    return this.connection.sendDiagnostics({
      uri,
      diagnostics: [...lexDiagnostics, ...parseDiagnostics],
    });
  }
}
