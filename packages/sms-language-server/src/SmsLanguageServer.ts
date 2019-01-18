import * as lsp from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
} from 'stardog-language-utils';
import { SmsParser } from 'millan';

@autoBindMethods
export class SmsLanguageServer extends AbstractLanguageServer<SmsParser> {
  constructor(connection: lsp.IConnection) {
    super(connection, new SmsParser({ errorMessageProvider }));
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
    parseResults: ReturnType<AbstractLanguageServer<SmsParser>['parseDocument']>
  ): void {
    const { uri } = document;
    const content = document.getText();
    const { errors, tokens } = parseResults;

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: [],
      });
      return;
    }

    const lexDiagnostics = this.getLexDiagnostics(document, tokens);
    const parseDiagnostics = this.getParseDiagnostics(document, errors);

    return this.connection.sendDiagnostics({
      uri,
      diagnostics: [...lexDiagnostics, ...parseDiagnostics],
    });
  }
}
