import * as lsp from 'vscode-languageserver';
import { Parser, IToken } from 'chevrotain';
import { IStardogParser, isCstNode, traverse, ISemanticError } from 'millan';
import { ParseStateManager, getParseStateManager } from './parseState';

export abstract class AbstractLanguageServer<
  T extends Parser & IStardogParser
> {
  protected readonly documents: lsp.TextDocuments;
  protected readonly parseStateManager: ParseStateManager;

  constructor(
    protected readonly connection: lsp.IConnection,
    protected readonly parser: T
  ) {
    this.documents = new lsp.TextDocuments();
    this.parseStateManager = getParseStateManager();
    this.documents.listen(connection);
    this.documents.onDidChangeContent(this.handleContentChange.bind(this));
    this.documents.onDidClose(this.handleDocumentClose.bind(this));
    this.connection.onRequest(this.handleUninitializedRequest.bind(this));
    this.connection.onInitialize(this.handleInitialization.bind(this));
  }

  start() {
    this.connection.listen();
  }

  handleUninitializedRequest: lsp.StarRequestHandler = () =>
    new lsp.ResponseError(
      lsp.ErrorCodes.ServerNotInitialized,
      'Expecting "initialize" request from client.'
    );

  handleUnhandledRequest: lsp.StarRequestHandler = (method) =>
    new lsp.ResponseError(
      lsp.ErrorCodes.MethodNotFound,
      `Request: "${method}" is not handled by the server.`
    );

  abstract onInitialization(params: lsp.InitializeParams);
  private handleInitialization(
    params: lsp.InitializeParams
  ): lsp.InitializeResult {
    // Setting this StarHandler is intended to overwrite the handler set
    // in the constructor, which always responded with a "Server not initialized"
    // error. Here, we're initialized, so we replace with an "Unhandled method"
    this.connection.onRequest(this.handleUnhandledRequest.bind(this));
    this.connection.onHover(this.handleHover.bind(this));
    return this.onInitialization(params);
  }

  abstract onContentChange(
    params: lsp.TextDocumentChangeEvent,
    parseResults: ReturnType<AbstractLanguageServer<T>['parseDocument']>
  ): void;
  private handleContentChange(params: lsp.TextDocumentChangeEvent) {
    const { document } = params;
    const { uri } = document;
    const { cst, errors, tokens, otherParseData } = this.parseDocument(
      document
    );
    this.parseStateManager.saveParseStateForUri(uri, { cst, tokens });
    return this.onContentChange(params, {
      cst,
      errors,
      tokens,
      otherParseData,
    });
  }

  handleHover(params: lsp.TextDocumentPositionParams): lsp.Hover {
    const { uri } = params.textDocument;
    const document = this.documents.get(uri);
    const content = document.getText();
    let { cst } = this.parseStateManager.getParseStateForUri(uri);

    if (!cst) {
      const { cst: newCst } = this.parseDocument(document);
      cst = newCst;
      this.parseStateManager.saveParseStateForUri(uri, { cst });
    }

    const offsetAtPosition = document.offsetAt(params.position);
    const currentRuleTokens: IToken[] = [];
    let cursorTkn: IToken;
    let currentRule: string;

    const tokenCollector = (ctx, next) => {
      if (isCstNode(ctx.node)) {
        return next();
      }
      currentRuleTokens.push(ctx.node);
    };

    const findCurrentRule = (ctx, next) => {
      const { node, parentCtx } = ctx;
      if (isCstNode(node)) {
        return next();
      }
      // must be a token
      if (
        parentCtx.node &&
        offsetAtPosition >= node.startOffset &&
        offsetAtPosition <= node.endOffset
      ) {
        // found token that user's cursor is hovering over
        cursorTkn = node;
        currentRule = parentCtx.node.name;

        traverse(parentCtx.node, tokenCollector);
      }
    };

    traverse(cst, findCurrentRule);

    // get first and last tokens' positions
    const currentRuleRange = currentRuleTokens.reduce(
      (memo, token) => {
        if (token.endOffset > memo.endOffset) {
          memo.endOffset = token.endOffset;
        }
        if (token.startOffset < memo.startOffset) {
          memo.startOffset = token.startOffset;
        }
        return memo;
      },
      {
        startOffset: content.length,
        endOffset: 0,
      }
    );

    if (!cursorTkn) {
      return {
        contents: [],
      };
    }
    return {
      contents: `\`\`\`
${currentRule}
\`\`\``,
      range: {
        start: document.positionAt(currentRuleRange.startOffset),
        end: document.positionAt(currentRuleRange.endOffset + 1),
      },
    };
  }

  handleDocumentClose({ document }: lsp.TextDocumentChangeEvent) {
    // In the future, if we want to handle things like 'GoToDefinition', we may
    // want to keep something around here. For now, we just get rid of it.
    this.parseStateManager.clearParseStateForUri(document.uri);
  }

  parseDocument(document: lsp.TextDocument) {
    const content = document.getText();
    const { cst, errors, ...otherParseData } = this.parser.parse(content);
    const tokens = this.parser.input;

    return {
      cst,
      tokens,
      errors,
      otherParseData: otherParseData as Omit<
        ReturnType<T['parse']>,
        'cst' | 'errors'
      >,
    };
  }

  getLexDiagnostics(document: lsp.TextDocument, tokens: IToken[]) {
    return tokens
      .filter((res) => res.tokenType.tokenName === 'Unknown')
      .map(
        (unknownToken): lsp.Diagnostic => ({
          severity: lsp.DiagnosticSeverity.Error,
          message: `Unknown token`,
          range: {
            start: document.positionAt(unknownToken.startOffset),
            // chevrotains' token sends our inclusive
            end: document.positionAt(unknownToken.endOffset + 1),
          },
        })
      );
  }

  getParseDiagnostics(document: lsp.TextDocument, errors: ISemanticError[]) {
    const content = document.getText();

    return errors.map(
      (error): lsp.Diagnostic => {
        const { message, context, token } = error;
        const ruleStack = context ? context.ruleStack : null;
        const source =
          ruleStack && ruleStack.length > 0
            ? ruleStack[ruleStack.length - 1]
            : null;
        const constructedDiagnostic: Partial<lsp.Diagnostic> = {
          message,
          source,
          severity: lsp.DiagnosticSeverity.Error,
        };

        if (token.tokenType.tokenName !== 'EOF') {
          constructedDiagnostic.range = lsp.Range.create(
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

          constructedDiagnostic.range = lsp.Range.create(
            document.positionAt(rangeStart),
            document.positionAt(rangeEnd)
          );
        }

        return constructedDiagnostic as lsp.Diagnostic;
      }
    );
  }
}
