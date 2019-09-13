import * as lsp from 'vscode-languageserver';
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
  constructor(connection: lsp.IConnection) {
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

  onInitialization(_params: lsp.InitializeParams): lsp.InitializeResult {
    this.connection.onCompletion(this.handleCompletion);

    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        completionProvider: {
          triggerCharacters: ['<', ':'],
        },
        hoverProvider: true,
      },
    };
  }

  onContentChange(
    { document }: lsp.TextDocumentChangeEvent,
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

  handleCompletion(
    params: lsp.TextDocumentPositionParams
  ): lsp.CompletionItem[] {
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
    ): lsp.TextEdit => {
      let textEditRange: lsp.Range;

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

      return lsp.TextEdit.replace(textEditRange, replacement);
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
    ) => lsp.TextEdit
  ): lsp.CompletionItem | lsp.CompletionItem[] | void {
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
      ) as lsp.CompletionItem[];
    }

    if (typeof pattern === 'string') {
      return {
        label: pattern,
        kind: lsp.CompletionItemKind.EnumMember,
        textEdit: tokenReplacer(pattern, candidate.replacementRange),
      };
    } else if (pattern instanceof RegExp && tokenName in sparqlKeywords) {
      const keywordString = regexPatternToString(pattern);
      return {
        label: keywordString,
        kind: lsp.CompletionItemKind.EnumMember,
        textEdit: tokenReplacer(keywordString, candidate.replacementRange),
      };
    } else {
      // This token uses a custom pattern-matching function or a non-keyword
      // regex pattern and we therefore cannot use its pattern for autocompletion.
      return;
    }
  }
}
