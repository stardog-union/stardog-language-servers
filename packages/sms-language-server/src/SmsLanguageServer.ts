import {
  CompletionItem,
  CompletionItemKind,
  FoldingRangeRequestParam,
  FoldingRange,
  IConnection,
  InitializeParams,
  InitializeResult,
  InsertTextFormat,
  Range,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextEdit,
} from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
  sms2Snippets,
} from 'stardog-language-utils';
import { SmsParser } from 'millan';

@autoBindMethods
export class SmsLanguageServer extends AbstractLanguageServer<SmsParser> {
  constructor(connection: IConnection) {
    super(connection, new SmsParser({ errorMessageProvider }));
  }

  onInitialization(_params: InitializeParams): InitializeResult {
    this.connection.onCompletion(this.handleCompletion);
    this.connection.onFoldingRanges(this.handleFoldingRanges);

    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        hoverProvider: true,
        foldingRangeProvider: true,
        completionProvider: {
          triggerCharacters: ['<', ':', '?', '$'],
        },
      },
    };
  }

  onContentChange(
    { document }: TextDocumentChangeEvent,
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
      } else if (indentNextLevel > indentLevel) {
        const range = this.getIndentFoldingRange(lines, lineIdx);
        if (range) {
          ranges.push(range);
        }
      }
      lineIdx++;
    }
    return ranges;
  }

  handleCompletion(params: TextDocumentPositionParams): CompletionItem[] {
    const { uri } = params.textDocument;
    const document = this.documents.get(uri);
    const cursorOffset = document.offsetAt(params.position);
    let { tokens } = this.parseStateManager.getParseStateForUri(uri);

    if (!tokens) {
      const { tokens: newTokens, cst } = this.parseDocument(document);
      tokens = newTokens;
      this.parseStateManager.saveParseStateForUri(uri, { cst, tokens });
    }

    let tokenIndexBeforeCursor = -1;
    for (let index = tokens.length - 1; index > -1; index--) {
      const token = tokens[index];
      if (token.endOffset + 1 < cursorOffset) {
        tokenIndexBeforeCursor = index;
        break;
      }
    }

    const tokenAfterTokenBeforeCursor = tokens[tokenIndexBeforeCursor + 1];
    const isCursorInToken =
      tokenAfterTokenBeforeCursor &&
      tokenAfterTokenBeforeCursor.startOffset <= cursorOffset &&
      tokenAfterTokenBeforeCursor.endOffset >= cursorOffset &&
      tokenAfterTokenBeforeCursor.startOffset !==
        tokenAfterTokenBeforeCursor.endOffset;

    if (isCursorInToken) {
      // For now, this server only handles completion for snippets, which
      // should never be placed in the middle of a token, so we bail early.
      return;
    }

    const completions = this.parser.computeContentAssist(
      'MappingDoc',
      tokenIndexBeforeCursor === -1
        ? []
        : tokens.slice(0, tokenIndexBeforeCursor + 1)
    );

    if (
      completions.some(
        (completion) => completion.nextTokenType.tokenName === 'Mapping'
      )
    ) {
      return [
        {
          label: 'basicSMS2Mapping',
          kind: CompletionItemKind.Enum,
          detail: 'Create a basic fill-in-the-blanks SMS2 mapping',
          documentation:
            'Inserts a basic mapping in Stardog Mapping Syntax 2 (SMS2) with tabbing functionality and content assistance. For more documentation of SMS2, check out "Help" --> "Stardog Docs".',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: TextEdit.replace(
            Range.create(
              document.positionAt(cursorOffset - 1),
              document.positionAt(cursorOffset - 1)
            ),
            sms2Snippets.basicSMS2Mapping
          ),
        },
      ];
    }
  }
}
