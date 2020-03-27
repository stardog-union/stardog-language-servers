import {
  CompletionItem,
  CompletionItemKind,
  FoldingRange,
  FoldingRangeRequestParam,
  IConnection,
  InitializeParams,
  InitializeResult,
  Range,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextEdit,
} from 'vscode-languageserver';
import uniqBy from 'lodash.uniqby';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
  CompletionCandidate,
  regexPatternToString,
  getTokenTypesForCategory,
} from 'stardog-language-utils';
import { ShaclParser, shaclTokens, sparqlKeywords } from 'millan';
import { Lexer, TokenType } from 'chevrotain';

const SHACL_TOKEN_PREFIX = 'SHACL_';
const PREFIXED_SUFFIX = '_prefixed';
const IRI_SUFFIX = '_IRI';
const shaclTokenMap = shaclTokens.getShaclTokenMap({
  // TODO in future: put this inside of ShaclLanguageServer and allow client to
  // specify arbitrary namespaces. This is already supported by `millan`'s
  // parser.
  shacl: 'sh',
  xsd: 'xsd',
});
const baseShaclTokens = Object.keys(shaclTokenMap).reduce(
  (accumulator, key) =>
    key.endsWith(PREFIXED_SUFFIX) || key.endsWith(IRI_SUFFIX)
      ? accumulator
      : accumulator.concat(shaclTokenMap[key]),
  [] as TokenType[]
);

@autoBindMethods
export class ShaclLanguageServer extends AbstractLanguageServer<ShaclParser> {
  constructor(connection: IConnection) {
    super(
      connection,
      new ShaclParser(
        { errorMessageProvider },
        {
          shacl: 'sh',
          xsd: 'xsd',
        }
      )
    );
  }

  onInitialization(_params: InitializeParams): InitializeResult {
    this.connection.onCompletion(this.handleCompletion);
    this.connection.onFoldingRanges(this.handleFoldingRanges);

    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        completionProvider: {
          triggerCharacters: ['<', ':'],
        },
        foldingRangeProvider: true,
        hoverProvider: true,
      },
    };
  }

  onContentChange(
    { document }: TextDocumentChangeEvent,
    parseResults: ReturnType<
      AbstractLanguageServer<ShaclParser>['parseDocument']
    >
  ) {
    const { uri } = document;
    const content = document.getText();
    const { errors, tokens, otherParseData } = parseResults;

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: [],
      });
      return;
    }

    const lexDiagnostics = this.getLexDiagnostics(document, tokens);
    const parseDiagnostics =
      otherParseData.semanticErrors.length > 0
        ? this.getParseDiagnostics(document, [
            ...errors,
            // NoNamespacePrefixErrors are not handled for now; it's a TODO
            ...otherParseData.semanticErrors.filter(
              (err) => err.name !== 'NoNamespacePrefixError'
            ),
          ])
        : this.getParseDiagnostics(document, errors);

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
    let { tokens } = this.parseStateManager.getParseStateForUri(uri);

    if (!tokens) {
      const { tokens: newTokens, cst } = this.parseDocument(document);
      tokens = newTokens;
      this.parseStateManager.saveParseStateForUri(uri, { cst, tokens });
    }

    const tokenIdxAtCursor = tokens.findIndex(
      (tkn) =>
        tkn.startOffset <= document.offsetAt(params.position) &&
        tkn.endOffset + 1 >= document.offsetAt(params.position)
    );

    if (tokenIdxAtCursor < 0) {
      return;
    }

    const tokenAtCursor = tokens[tokenIdxAtCursor];
    const tokensUpToCursor = tokens.slice(0, tokenIdxAtCursor);
    const candidates: CompletionCandidate[] = this.parser.computeContentAssist(
      'turtleDoc',
      tokensUpToCursor
    );

    const replaceTokenAtCursor = (
      replacement: string,
      replacementRange?: CompletionCandidate['replacementRange']
    ): TextEdit => {
      let textEditRange: Range;

      if (replacementRange) {
        textEditRange = {
          start: document.positionAt(replacementRange.start),
          end: document.positionAt(replacementRange.end),
        };
      } else {
        textEditRange = {
          start: document.positionAt(tokenAtCursor.startOffset),
          end: document.positionAt(tokenAtCursor.endOffset + 1),
        };
      }

      return TextEdit.replace(textEditRange, replacement);
    };

    // Completions are collected in this way (pushing, etc.) for
    // speed/complexity reasons (fewer map/filter/flatten operations needed).
    const allCompletions = [];
    candidates.forEach((candidate) => {
      const completionItem = this.getCompletionItem(
        candidate,
        replaceTokenAtCursor
      );
      if (!completionItem) {
        return;
      }

      if (Array.isArray(completionItem)) {
        allCompletions.push(...completionItem);
      } else {
        allCompletions.push(completionItem);
      }
    });

    return uniqBy(allCompletions, 'label');
  }

  private getCompletionItem(
    candidate: CompletionCandidate,
    tokenReplacer: (
      replacement: string,
      replacementRange?: CompletionCandidate['replacementRange']
    ) => TextEdit
  ): CompletionItem | CompletionItem[] | void {
    const { tokenName, PATTERN } = candidate.nextTokenType;
    const pattern = tokenName.startsWith(SHACL_TOKEN_PREFIX)
      ? shaclTokenMap[`${tokenName}_prefixed`].PATTERN
      : PATTERN;

    if (pattern.toString() === Lexer.NA.toString()) {
      // This is a SHACL category token, so collect completion items for all
      // tokens _within_ that category (the category itself is not an actual
      // token that can be used for completions).
      const tokenTypesForCategory = getTokenTypesForCategory(
        tokenName,
        baseShaclTokens
      );

      // Recursively get completion candidates for each token in the category
      return tokenTypesForCategory.map((subTokenType) =>
        this.getCompletionItem(
          {
            ...candidate,
            nextTokenType: subTokenType,
          },
          tokenReplacer
        )
      ) as CompletionItem[];
    }

    if (typeof pattern === 'string') {
      return {
        label: pattern,
        kind: CompletionItemKind.EnumMember,
        textEdit: tokenReplacer(pattern, candidate.replacementRange),
      };
    } else if (pattern instanceof RegExp && tokenName in sparqlKeywords) {
      const keywordString = regexPatternToString(pattern);
      return {
        label: keywordString,
        kind: CompletionItemKind.EnumMember,
        textEdit: tokenReplacer(keywordString, candidate.replacementRange),
      };
    } else {
      // This token uses a custom pattern-matching function or a non-keyword
      // regex pattern and we therefore cannot use its pattern for autocompletion.
      return;
    }
  }
}
