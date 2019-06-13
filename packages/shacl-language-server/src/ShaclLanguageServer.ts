import * as lsp from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
  CompletionCandidate,
  regexPatternToString,
} from 'stardog-language-utils';
import { ShaclParser, shaclTokens } from 'millan';

const shaclTokenMap = shaclTokens.getShaclTokenMap({
  // TODO in future: put this inside of ShaclLanguageServer and allow client to
  // specify arbitrary namespaces. This is already supported by `millan`'s
  // parser.
  shacl: 'sh',
  xsd: 'xsd',
});

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

    const tokenIdxAtCursor = tokens.findIndex((tkn) => {
      if (
        tkn.startOffset <= document.offsetAt(params.position) &&
        tkn.endOffset + 1 >= document.offsetAt(params.position)
      ) {
        return true;
      }
      return false;
    });

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

    const completions = candidates.map((candidate) => {
      const pattern = candidate.nextTokenType.tokenName.startsWith('SHACL_')
        ? shaclTokenMap[`${candidate.nextTokenType.tokenName}_prefixed`].PATTERN
        : candidate.nextTokenType.PATTERN;
      let completionString;

      if (typeof pattern === 'string') {
        completionString = pattern;
      } else if (
        pattern instanceof RegExp &&
        pattern.toString() !== '/NOT_APPLICABLE/'
      ) {
        completionString = regexPatternToString(pattern);
      } else {
        // Can happen in the rare case where the pattern is a custom function.
        // We can't currently provide completions in that case.
        return;
      }

      return {
        label: completionString,
        kind: lsp.CompletionItemKind.EnumMember,
        textEdit: replaceTokenAtCursor(
          completionString,
          candidate.replacementRange
        ),
      };
    });

    return completions.filter(Boolean);
  }
}
