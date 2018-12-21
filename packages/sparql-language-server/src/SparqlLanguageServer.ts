import {
  TextDocuments,
  InitializeResult,
  TextDocumentPositionParams,
  Hover,
  TextDocumentChangeEvent,
  Diagnostic,
  Range,
  DiagnosticSeverity,
  IConnection,
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  InitializeParams,
  ResponseError,
  ErrorCodes,
  StarRequestHandler,
} from 'vscode-languageserver';
import {
  StardogSparqlParser,
  W3SpecSparqlParser,
  traverse,
  isCstNode,
  sparqlKeywords,
  IToken,
  CstNode,
} from 'millan';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  getUniqueIdentifiers,
  isVar,
  isPrefix,
  isLocalName,
  isIriRef,
  regexPatternToString,
  errorMessageProvider,
  abbreviatePrefixObj,
  namespaceArrayToObj,
  LSPExtensionMethod,
  SparqlCompletionData,
} from 'stardog-language-utils';
import * as uniq from 'lodash.uniq';

const ARBITRARILY_LARGE_NUMBER = 100000000000000;

@autoBindMethods
export class SparqlLanguageServer {
  protected readonly documents = new TextDocuments();
  private parser: StardogSparqlParser | W3SpecSparqlParser;
  private latestTokens: IToken[];
  private latestCst: CstNode;

  private namespaceMap = {};
  private relationshipCompletionItems = [];
  private typeCompletionItems = [];

  constructor(protected readonly connection: IConnection) {
    this.documents.listen(this.connection);
    this.documents.onDidChangeContent(this.handleContentChange);
    this.connection.onRequest(this.handleUninitializedRequest);
    this.connection.onInitialize(this.handleInitialization);
  }

  start() {
    this.connection.listen();
  }

  handleUninitializedRequest: StarRequestHandler = () =>
    new ResponseError(
      ErrorCodes.ServerNotInitialized,
      'Expecting "initialize" request from client.'
    );
  handleUnhandledRequest: StarRequestHandler = (method) =>
    new ResponseError(
      ErrorCodes.MethodNotFound,
      `Request: "${method}" is not handled by the server.`
    );

  handleInitialization(params: InitializeParams): InitializeResult {
    // Setting this StarHandler is intended to overwrite the handler set
    // in the constructor, which always responded with a "Server not initialized"
    // error. Here, we're initialized, so we replace with an "Unhandled method"
    this.connection.onRequest(this.handleUnhandledRequest);
    this.connection.onCompletion(this.handleCompletion);
    this.connection.onHover(this.handleHover);
    this.connection.onNotification(
      LSPExtensionMethod.DID_UPDATE_COMPLETION_DATA,
      this.handleUpdateCompletionData
    );

    if (
      params.initializationOptions &&
      params.initializationOptions.grammar === 'w3'
    ) {
      this.parser = new W3SpecSparqlParser({
        config: { errorMessageProvider },
      });
    } else {
      this.parser = new StardogSparqlParser({
        config: { errorMessageProvider },
      });
    }

    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
        completionProvider: {
          triggerCharacters: ['<', ':', '?', '$'],
        },
        hoverProvider: true,
      },
    };
  }

  handleUpdateCompletionData(update: SparqlCompletionData) {
    if (update.namespaceMap) {
      this.namespaceMap = namespaceArrayToObj(update.namespaceMap);
    }
    if (update.relationshipBindings) {
      this.relationshipCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        update.relationshipBindings.map((binding) => ({
          iri: binding.relationship.value,
          count: binding.count.value,
        }))
      );
    }
    if (update.typeBindings) {
      this.typeCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        update.typeBindings.map((binding) => ({
          iri: binding.type.value,
          count: binding.count.value,
        }))
      );
    }
  }

  buildCompletionItemsFromData(
    namespaceMap,
    irisAndCounts: { iri: string; count: string }[]
  ): CompletionItem[] {
    const prefixed: CompletionItem[] = [];
    const full: CompletionItem[] = irisAndCounts.map(({ iri, count }) => {
      let prefixedIri;
      const alphaSortTextForCount =
        ARBITRARILY_LARGE_NUMBER - parseInt(count, 10);
      if (namespaceMap) {
        prefixedIri = abbreviatePrefixObj(iri, namespaceMap);
      }
      if (prefixedIri !== iri) {
        prefixed.push({
          label: prefixedIri,
          kind: CompletionItemKind.Field,

          // here we take the difference of an arbitrarily large number and the iri's count which allows us to invert the
          // sort order of the items to be highest count number first. "00" is appended to ensure precedence over full iri,
          // suggestions
          sortText: `00${alphaSortTextForCount}${prefixedIri}`,

          // here we concatenate both the full iri and the prefixed iri so that users who begin typing
          // the full iri will see the prefixed alternative
          filterText: `<${iri}>${prefixedIri}`,
          detail: `${count} occurrences`,
        });
      }
      return {
        label: `<${iri}>`,
        kind: CompletionItemKind.EnumMember,
        sortText: `01${alphaSortTextForCount}${iri}`,
        detail: `${count} occurrences`,
      };
    });
    const fullList = full.concat(prefixed);
    return fullList;
  }

  handleHover(params: TextDocumentPositionParams): Hover {
    const document = this.documents.get(params.textDocument.uri);
    const content = document.getText();
    const cst = this.latestCst;

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

    // const currentRuleText = content.slice(
    //   currentRuleRange.startOffset,
    //   currentRuleRange.endOffset + 1
    // );

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

  handleCompletion(params: TextDocumentPositionParams): CompletionItem[] {
    const document = this.documents.get(params.textDocument.uri);
    const tokens = this.latestTokens;

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
    const tokensAfterCursor = tokens.slice(tokenIdxAtCursor + 1);
    const tokenBeforeCursor = tokens[tokenIdxAtCursor - 1];
    const tokensBeforeAndAfterCursor = [
      ...tokensUpToCursor,
      ...tokensAfterCursor,
    ];

    const { vars, prefixes, localNames, iris } = getUniqueIdentifiers(
      tokensBeforeAndAfterCursor
    );

    const candidates = this.parser.computeContentAssist(
      'SparqlDoc',
      tokensUpToCursor
    );

    const replaceTokenAtCursor = (replacement: string): TextEdit =>
      TextEdit.replace(
        {
          start: document.positionAt(tokenAtCursor.startOffset),
          end: document.positionAt(tokenAtCursor.endOffset + 1),
        },
        replacement
      );

    const variableCompletions: CompletionItem[] = vars.map((variable) => {
      return {
        label: variable,
        kind: CompletionItemKind.Variable,
        sortText: candidates.some((tkn) => isVar(tkn.nextTokenType.tokenName))
          ? `1${variable}` // number prefix used to force ordering of suggestions to user
          : null,
        textEdit: replaceTokenAtCursor(variable),
      };
    });

    if (this.namespaceMap) {
      prefixes.push(...Object.keys(this.namespaceMap));
    }

    const prefixCompletions: CompletionItem[] = prefixes.map((prefix) => {
      const label = prefix.replace(/:$/, '');
      return {
        label,
        kind: CompletionItemKind.EnumMember,
        sortText: candidates.some((tkn) =>
          isPrefix(tkn.nextTokenType.tokenName)
        )
          ? `2${label}` // number prefix used to force ordering of suggestions to user
          : null,
        textEdit: replaceTokenAtCursor(prefix),
      };
    });

    const localCompletions: CompletionItem[] = localNames.map((local) => ({
      label: local,
      kind: CompletionItemKind.EnumMember,
      sortText: candidates.some((tkn) =>
        isLocalName(tkn.nextTokenType.tokenName)
      )
        ? `2${local}` // number prefix used to force ordering of suggestions to user
        : null,
      textEdit: replaceTokenAtCursor(local),
    }));

    const iriCompletions: CompletionItem[] = iris.map((iri) => ({
      label: iri,
      kind: CompletionItemKind.EnumMember,
      sortText: candidates.some((tkn) => isIriRef(tkn.nextTokenType.tokenName))
        ? `2${iri}` // number prefix used to force ordering of suggestions to user
        : null,
      textEdit: replaceTokenAtCursor(iri),
    }));

    // Unlike the previous completion types, sparqlKeywords only appear in dropdown if they're valid
    const keywordCompletions = uniq(
      candidates
        .filter((item) => item.nextTokenType.tokenName in sparqlKeywords)
        .filter((item) => item.nextTokenType.tokenName !== tokenAtCursor.image)
        .map((keywordTkn) =>
          regexPatternToString(keywordTkn.nextTokenType.PATTERN)
        )
    ).map((keyword) => ({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      textEdit: replaceTokenAtCursor(keyword),
    }));

    const finalCompletions = [
      ...variableCompletions,
      ...prefixCompletions,
      ...localCompletions,
      ...iriCompletions,
      ...keywordCompletions,
    ];

    const shouldIncludeTypes =
      tokenBeforeCursor && tokenBeforeCursor.tokenType.tokenName === 'A';

    // Each "candidate" is essentially a tokenType that would be valid as the next entry
    // in the query. Also contained on the candidate is a "rule stack": an array
    // of the grammar rules in the parser's stack leading to the expectation of the "candidate"
    // tokenType. For each candidate, we want to check its ruleStack for whether it contains
    // any of the rules that signify "edges" in a graph.
    //
    // N.B. In the SPARQL grammar, this happens to be any rule that contains the token 'a'.
    const shouldIncludeRelationships = candidates.some((candidate) => {
      return candidate.ruleStack.some((rule) => {
        return ['Verb', 'PathPrimary', 'PathOneInPropertySet'].some(
          (verbRule) => rule === verbRule
        );
      });
    });

    if (this.relationshipCompletionItems.length && shouldIncludeRelationships) {
      finalCompletions.push(
        ...this.relationshipCompletionItems.map((item) => ({
          ...item,
          textEdit: replaceTokenAtCursor(item.label),
        }))
      );
    }

    if (this.typeCompletionItems.length && shouldIncludeTypes) {
      finalCompletions.push(
        ...this.typeCompletionItems.map((item) => ({
          ...item,
          textEdit: replaceTokenAtCursor(item.label),
        }))
      );
    }

    return finalCompletions;
  }

  handleContentChange(change: TextDocumentChangeEvent) {
    const content = change.document.getText();

    const { cst, errors: parseErrors } = this.parser.parse(content);
    this.latestCst = cst;
    this.latestTokens = this.parser.input;

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri: change.document.uri,
        diagnostics: [],
      });
      return;
    }

    // The purpose of this block is to catch any "unknown" tokens. Since
    // any unknown token could be a stardog or custom function, we can't
    // produce diagnostics like this anymore.

    // const lexDiagnostics = this.latestTokens
    //   .filter((res) => res.tokenType.tokenName === 'Unknown')
    //   .map((unknownToken): Diagnostic => ({
    //     severity: DiagnosticSeverity.Error,
    //     message: `Unknown token`,
    //     range: {
    //       start: change.document.positionAt(unknownToken.startOffset),
    //       // chevrotains' token sends our inclusive
    //       end: change.document.positionAt(unknownToken.endOffset + 1),
    //     },
    //   }));

    const parseDiagnostics = parseErrors.map(
      (error): Diagnostic => {
        const { message, context, token } = error;
        const { ruleStack } = context;
        const range =
          token.tokenType.tokenName === 'EOF'
            ? Range.create(
                change.document.positionAt(content.length),
                change.document.positionAt(content.length)
              )
            : Range.create(
                change.document.positionAt(token.startOffset),
                change.document.positionAt(token.endOffset + 1)
              );

        return {
          message,
          source: ruleStack.length ? ruleStack.pop() : null,
          severity: DiagnosticSeverity.Error,
          range,
        };
      }
    );

    const finalDiagnostics = [
      // ...lexDiagnostics,
      ...parseDiagnostics,
    ];

    this.connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics: finalDiagnostics,
    });
  }
}
