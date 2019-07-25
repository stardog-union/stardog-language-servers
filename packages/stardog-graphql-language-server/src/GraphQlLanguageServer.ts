import {
  InitializeResult,
  TextDocumentChangeEvent,
  InitializeParams,
  IConnection,
  TextDocumentPositionParams,
  CompletionItem,
  Range,
  TextEdit,
  CompletionItemKind,
  TextDocument,
  Diagnostic,
  DiagnosticSeverity,
} from 'vscode-languageserver';
import uniqBy from 'lodash.uniqby';
import {
  StandardGraphQlParser,
  StardogGraphQlParser,
} from 'millan/dist/standalone/millan.graphql';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
  CompletionCandidate,
} from 'stardog-language-utils';
import { ISemanticError } from 'millan';

const SPARQL_ERROR_PREFIX = 'SPARQL Error: ';

@autoBindMethods
export class GraphQlLanguageServer extends AbstractLanguageServer<
  StardogGraphQlParser | StandardGraphQlParser
> {
  protected parser: StardogGraphQlParser | StandardGraphQlParser;

  constructor(connection: IConnection) {
    // Like the SPARQL server, the GraphQl server instantiates a different parser
    // depending on initialization params
    super(connection, null);
  }

  onInitialization(params: InitializeParams): InitializeResult {
    this.connection.onCompletion(this.handleCompletion);

    if (
      params.initializationOptions &&
      params.initializationOptions.grammar === 'standard'
    ) {
      this.parser = new StandardGraphQlParser({
        config: { errorMessageProvider },
      });
    } else {
      this.parser = new StardogGraphQlParser({
        config: { errorMessageProvider },
      });
    }

    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        completionProvider: {
          triggerCharacters: ['$'],
        },
        hoverProvider: true,
      },
    };
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
      'Document',
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
        allCompletions.push(...completionItem.filter(Boolean));
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
    const { PATTERN } = candidate.nextTokenType;

    if (typeof PATTERN !== 'string') {
      // This token uses either a custom pattern-matching function or a regex
      // and we therefore cannot use its pattern for autocompletion.
      return;
    }

    return {
      label: PATTERN,
      kind: CompletionItemKind.EnumMember,
      textEdit: tokenReplacer(PATTERN, candidate.replacementRange),
    };
  }

  onContentChange(
    { document }: TextDocumentChangeEvent,
    parseResult: ReturnType<
      AbstractLanguageServer<
        StardogGraphQlParser | StandardGraphQlParser
      >['parseDocument']
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

    const { errors } = parseResult;
    const diagnostics = this.getParseDiagnostics(document, errors);

    this.connection.sendDiagnostics({
      uri,
      diagnostics,
    });
  }

  // OVERRIDE for special EOF error token handling in case of SPARQL errors
  getParseDiagnostics(document: TextDocument, errors: ISemanticError[]) {
    const content = document.getText();

    return errors.map(
      (error): Diagnostic => {
        const { message, context, token, name } = error;
        const ruleStack = context ? context.ruleStack : null;
        const source =
          ruleStack && ruleStack.length > 0
            ? ruleStack[ruleStack.length - 1]
            : null;
        const constructedDiagnostic: Partial<Diagnostic> = {
          message,
          source,
          severity: DiagnosticSeverity.Error,
        };

        // For the GraphQL parser, internal SPARQL errors can have EOF tokens,
        // but those tokens _will_ have startOffset and endOffset, so we can
        // still use them. Thus, we only have special behavior when there's an
        // EOF token that _isn't_ produced as part of a SPARQL error.
        if (
          token.tokenType.tokenName !== 'EOF' ||
          name.startsWith(SPARQL_ERROR_PREFIX)
        ) {
          constructedDiagnostic.range = Range.create(
            document.positionAt(token.startOffset),
            document.positionAt(token.endOffset + 1)
          );
        } else {
          const { previousToken = {} } = error as any; // chevrotain doesn't have this typed fully, but it exists for early exit exceptions
          let rangeStart;
          let rangeEnd;

          if (typeof previousToken.endOffset !== 'undefined') {
            rangeStart = Math.min(previousToken.endOffset + 1, content.length);
            rangeEnd = Math.min(previousToken.endOffset + 2, content.length);
          } else {
            rangeStart = rangeEnd = content.length;
          }

          constructedDiagnostic.range = Range.create(
            document.positionAt(rangeStart),
            document.positionAt(rangeEnd)
          );
        }

        return constructedDiagnostic as Diagnostic;
      }
    );
  }
}
