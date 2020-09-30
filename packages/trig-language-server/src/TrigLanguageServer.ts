import {
  FoldingRangeRequestParam,
  IConnection,
  InitializeParams,
  InitializeResult,
  TextDocument,
  TextDocumentChangeEvent,
} from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  AbstractLanguageServer,
  errorMessageProvider,
} from 'stardog-language-utils';
import { TrigParser, ModeString } from 'millan';

@autoBindMethods
export class TrigLanguageServer extends AbstractLanguageServer<TrigParser> {
  private mode: ModeString = 'standard';

  constructor(connection: IConnection) {
    super(connection, new TrigParser({ errorMessageProvider }));
  }

  onInitialization(params: InitializeParams): InitializeResult {
    this.connection.onFoldingRanges((params: FoldingRangeRequestParam) =>
      this.handleFoldingRanges(params, true, true)
    );
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
        foldingRangeProvider: true,
        hoverProvider: true,
      },
    };
  }

  onContentChange(
    { document }: TextDocumentChangeEvent,
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

  // Override to allow parsing modes.
  parseDocument(document: TextDocument) {
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
        ReturnType<TrigParser['parse']>,
        'cst' | 'errors'
      >,
    };
  }
}
