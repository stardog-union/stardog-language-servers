import {
  FoldingRange,
  FoldingRangeRequestParam,
  IConnection,
  InitializeParams,
  InitializeResult,
  TextDocument,
  TextDocumentChangeEvent,
} from 'vscode-languageserver';
import {
  AbstractLanguageServer,
  errorMessageProvider,
} from 'stardog-language-utils';
import { TurtleParser, ModeString } from 'millan';

export class TurtleLanguageServer extends AbstractLanguageServer<TurtleParser> {
  private mode: ModeString = 'standard';

  constructor(connection: IConnection) {
    super(connection, new TurtleParser({ errorMessageProvider }));
  }

  onInitialization(params: InitializeParams): InitializeResult {
    this.connection.onFoldingRanges(this.handleFoldingRanges);
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

  getIndentFoldingRange(lines, lineIdx) {
    const start = lineIdx;
    const startingLine = lines[lineIdx];
    const startIndentLevel =
      startingLine.length - startingLine.trimLeft().length;

    for (let i = lineIdx + 1; i < lines.length; i++) {
      const lowerCaseLine = lines[i].toLowerCase();
      const trimmedLine = lowerCaseLine.trimLeft();
      const indentLevel = lowerCaseLine.length - trimmedLine.length;

      if (indentLevel <= startIndentLevel) {
        return {
          startLine: start,
          endLine: i - 1,
          kind: 'indent',
        };
      }
    }
    return {
      startLine: start,
      endLine: lines.length - 1,
      kind: 'indent',
    };
  }

  getPrefixFoldingRange(lines, lineIdx) {
    const startLine = lineIdx;

    for (let i = lineIdx + 1; i < lines.length; i++) {
      const lowerCaseLine = lines[i].toLowerCase().trimLeft();
      if (
        !lowerCaseLine.startsWith('prefix') &&
        !lowerCaseLine.startsWith('@prefix')
      ) {
        return {
          startLine,
          endLine: i - 1,
          kind: 'prefix',
        };
      }
    }
    return null;
  }

  handleFoldingRanges(params: FoldingRangeRequestParam): FoldingRange[] {
    const { uri } = params.textDocument;
    const document = this.documents.get(uri);
    const ranges: FoldingRange[] = [];

    if (!document) {
      return ranges;
    }

    const lines = document.getText().split(/\r?\n/);
    let lineIdx = 0;
    while (lineIdx < lines.length - 1) {
      const lowerCaseLine = lines[lineIdx].toLowerCase();
      const lowerCaseNextLine = lines[lineIdx + 1].toLowerCase();
      const trimmedLine = lowerCaseLine.trimLeft();
      const trimmedNextLine = lowerCaseNextLine.trimLeft();
      const indentLevel = lowerCaseLine.length - trimmedLine.length;
      const indentNextLevel = lowerCaseNextLine.length - trimmedNextLine.length;
      if (
        (trimmedLine.startsWith('prefix') ||
          trimmedLine.startsWith('@prefix')) &&
        (trimmedNextLine.startsWith('prefix') ||
          trimmedNextLine.startsWith('@prefix'))
      ) {
        const range = this.getPrefixFoldingRange(lines, lineIdx);
        if (range) {
          ranges.push(range);
          lineIdx = range.endLine;
        } else {
          lineIdx++;
        }
      } else if (trimmedLine && indentNextLevel > indentLevel) {
        const range = this.getIndentFoldingRange(lines, lineIdx);
        if (range) {
          ranges.push(range);
        }
      }
      lineIdx++;
    }
    return ranges;
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
        ReturnType<TurtleParser['parse']>,
        'cst' | 'errors'
      >,
    };
  }
}
