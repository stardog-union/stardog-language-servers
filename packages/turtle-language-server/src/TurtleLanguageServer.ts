import * as lsp from 'vscode-languageserver';
import {
  AbstractLanguageServer,
  errorMessageProvider,
} from 'stardog-language-utils';
import { TurtleParser, ModeString } from 'millan';

export class TurtleLanguageServer extends AbstractLanguageServer<TurtleParser> {
  private mode: ModeString = 'standard';

  constructor(connection: lsp.IConnection) {
    super(connection, new TurtleParser({ errorMessageProvider }));
  }

  onInitialization(params: lsp.InitializeParams): lsp.InitializeResult {
    if (
      params.initializationOptions &&
      (params.initializationOptions.mode === 'stardog' ||
        params.initializationOptions.mode === 'standard')
    ) {
      this.mode = params.initializationOptions.mode;
    }

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
      AbstractLanguageServer<TurtleParser>['parseDocument']
    >
  ) {
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

  // Override to allow parsing modes.
  parseDocument(document: lsp.TextDocument) {
    const content = document.getText();
    const { cst, errors, ...otherParseData } = this.parser.parse(
      content,
      this.mode
    );
    const tokens = this.parser.input;

    return {
      cst,
      tokens,
      errors,
      otherParseData: otherParseData as Omit<
        ReturnType<TurtleParser['parse']>,
        'cst' | 'errors'
      >,
    };
  }
}
