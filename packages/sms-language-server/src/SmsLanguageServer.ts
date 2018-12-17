import * as lsp from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import { errorMessageProvider } from 'stardog-language-utils';
import { SmsParser, isCstNode, traverse, IToken } from 'millan';

@autoBindMethods
export class SmsLanguageServer {
  protected readonly documents = new lsp.TextDocuments();
  private parser = new SmsParser({ errorMessageProvider });

  constructor(protected readonly connection: lsp.IConnection) {
    this.documents.listen(this.connection);
    this.documents.onDidChangeContent(this.handleContentChange);
    this.connection.onInitialize(this.handleInitialization);
    this.connection.onHover(this.handleHover);
  }

  start() {
    this.connection.listen();
  }

  handleInitialization(_params): lsp.InitializeResult {
    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        hoverProvider: true,
      },
    };
  }

  handleContentChange(change: lsp.TextDocumentChangeEvent): void {
    const content = change.document.getText();

    const { errors: parseErrors } = this.parser.parse(content);
    const latestTokens = this.parser.input;

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri: change.document.uri,
        diagnostics: [],
      });
      return;
    }

    const lexDiagnostics = latestTokens
      .filter((res) => res.tokenType.tokenName === 'Unknown')
      .map(
        (unknownToken): lsp.Diagnostic => ({
          severity: lsp.DiagnosticSeverity.Error,
          message: `Unknown token`,
          range: {
            start: change.document.positionAt(unknownToken.startOffset),
            // chevrotains' token sends our inclusive
            end: change.document.positionAt(unknownToken.endOffset + 1),
          },
        })
      );

    const parseDiagnostics = parseErrors.map(
      (error): lsp.Diagnostic => {
        const { message, context, token } = error;
        const { ruleStack } = context;
        const range =
          token.tokenType.tokenName === 'EOF'
            ? lsp.Range.create(
                change.document.positionAt(content.length),
                change.document.positionAt(content.length)
              )
            : lsp.Range.create(
                change.document.positionAt(token.startOffset),
                change.document.positionAt(token.endOffset + 1)
              );

        return {
          message,
          source: ruleStack.length ? ruleStack.pop() : null,
          severity: lsp.DiagnosticSeverity.Error,
          range,
        };
      }
    );

    const finalDiagnostics = [...lexDiagnostics, ...parseDiagnostics];

    return this.connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics: finalDiagnostics,
    });
  }

  handleHover(params: lsp.TextDocumentPositionParams): lsp.Hover {
    const document = this.documents.get(params.textDocument.uri);
    const content = document.getText();
    const { cst } = this.parser.parse(content);

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
        document.offsetAt(params.position) >= node.startOffset &&
        document.offsetAt(params.position) <= node.endOffset
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
}
