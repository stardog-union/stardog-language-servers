import { IToken } from 'chevrotain';
import { autoBindMethods } from 'class-autobind-decorator';
import uniqBy from 'lodash.uniqby';
import {
  StardogSparqlParser,
  W3SpecSparqlParser,
  sparqlKeywords,
} from 'millan';
import {
  ARBITRARILY_LARGE_NUMBER,
  AbstractLanguageServer,
  CompletionCandidate,
  LSPExtensionMethod,
  SparqlCompletionData,
  abbreviatePrefixObj,
  errorMessageProvider,
  getCommonCompletionItemsGivenNamespaces,
  getUniqueIdentifiers,
  isIriRef,
  isLocalName,
  isPrefix,
  isVar,
  makeCompletionItemFromPrefixedNameAndNamespaceIri,
  namespaceArrayToObj,
  regexPatternToString,
} from 'stardog-language-utils';
import {
  CompletionItem,
  CompletionItemKind,
  FoldingRangeRequestParam,
  IConnection,
  InitializeParams,
  InitializeResult,
  Range,
  TextDocument,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextEdit,
} from 'vscode-languageserver';

@autoBindMethods
export class SparqlLanguageServer extends AbstractLanguageServer<
  StardogSparqlParser | W3SpecSparqlParser
> {
  protected parser: StardogSparqlParser | W3SpecSparqlParser;
  private namespaceMap = {};
  private relationshipBindings = [];
  private relationshipCompletionItems = [];
  private typeBindings = [];
  private typeCompletionItems = [];

  constructor(connection: IConnection) {
    // Unlike other servers, the Sparql server instantiates a different parser
    // depending on initialization params
    super(connection, null);
  }

  onInitialization(params: InitializeParams): InitializeResult {
    this.connection.onCompletion(this.handleCompletion);
    this.connection.onFoldingRanges((params: FoldingRangeRequestParam) =>
      this.handleFoldingRanges(params, true, false)
    );
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
          triggerCharacters: ['<', '?', '$'],
        },
        foldingRangeProvider: true,
        hoverProvider: true,
      },
    };
  }

  handleUpdateCompletionData(update: SparqlCompletionData) {
    // `relationshipCompletionItems` and `typeCompletionItems` must be updated
    // in 2 different scenarios:
    // #1 - namespaces provided after relationshipBindings or typeBindings
    // #2 - namespaces provided before relationshipBindings or typeBindings
    // Otherwise you can find yourself with 1, both or neither reflecting the
    // namespace prefixes based on the order the updates are processed, which is
    // indeterminate.
    if (update.namespaces) {
      this.namespaceMap = namespaceArrayToObj(update.namespaces);
    }
    if (
      update.relationshipBindings ||
      (update.namespaces && this.relationshipBindings)
    ) {
      this.relationshipBindings =
        update.relationshipBindings || this.relationshipBindings;
      this.relationshipCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        this.relationshipBindings
          .map((binding) => ({
            iri:
              binding &&
              binding.relationship &&
              binding.relationship.value !== undefined
                ? binding.relationship.value
                : undefined,
            count:
              binding && binding.count && binding.count.value !== undefined
                ? binding.count.value
                : undefined,
          }))
          .filter(({ iri, count }) => iri !== undefined && count !== undefined)
      );
    }
    if (update.typeBindings || (update.namespaces && this.typeBindings)) {
      this.typeBindings = update.typeBindings || this.typeBindings;
      this.typeCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        this.typeBindings
          .map((binding) => ({
            iri:
              binding && binding.type && binding.type.value !== undefined
                ? binding.type.value
                : undefined,
            count:
              binding && binding.count && binding.count.value !== undefined
                ? binding.count.value
                : undefined,
          }))
          .filter(({ iri, count }) => iri !== undefined && count !== undefined)
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
          ...makeCompletionItemFromPrefixedNameAndNamespaceIri(
            prefixedIri,
            iri
          ),
          // here we take the difference of an arbitrarily large number and the iri's count which allows us to invert the
          // sort order of the items to be highest count number first. "00" is appended to ensure precedence over full iri,
          // suggestions
          sortText: `00${alphaSortTextForCount}${prefixedIri}`,
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

  replaceTokenAtCursor({
    document,
    replacement,
    replacementRange,
    tokenAtCursor,
  }: {
    document: TextDocument;
    replacement: string;
    replacementRange?: CompletionCandidate['replacementRange'];
    tokenAtCursor: IToken;
  }): TextEdit {
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
  }

  getRelationshipCompletions(document: TextDocument, tokenAtCursor: IToken) {
    return [
      ...this.relationshipCompletionItems.map((item) => ({
        ...item,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: item.label,
        }),
      })),
      ...getCommonCompletionItemsGivenNamespaces(
        this.namespaceMap || {}
      ).properties.map((item) => ({
        ...item,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: item.label,
        }),
      })),
    ];
  }

  getClassCompletions(document: TextDocument, tokenAtCursor: IToken) {
    return [
      ...this.typeCompletionItems.map((item) => ({
        ...item,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: item.label,
        }),
      })),
      ...getCommonCompletionItemsGivenNamespaces(
        this.namespaceMap || {}
      ).classes.map((item) => ({
        ...item,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: item.label,
        }),
      })),
    ];
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
    const tokensAfterCursor = tokens.slice(tokenIdxAtCursor + 1);
    const tokenBeforeCursor = tokens[tokenIdxAtCursor - 1];
    const tokensBeforeAndAfterCursor = [
      ...tokensUpToCursor,
      ...tokensAfterCursor,
    ];
    const { vars, prefixes, localNames, iris } = getUniqueIdentifiers(
      tokensBeforeAndAfterCursor
    );
    const candidates: CompletionCandidate[] = this.parser.computeContentAssist(
      'SparqlDoc',
      tokensUpToCursor
    );

    const variableCompletions: CompletionItem[] = vars.map((variable) => {
      return {
        label: variable,
        kind: CompletionItemKind.Variable,
        sortText: candidates.some((tkn) => isVar(tkn.nextTokenType.tokenName))
          ? `1${variable}` // number prefix used to force ordering of suggestions to user
          : null,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: variable,
        }),
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
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: prefix,
        }),
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
      textEdit: this.replaceTokenAtCursor({
        document,
        tokenAtCursor,
        replacement: local,
      }),
    }));

    const iriCompletions: CompletionItem[] = iris.map((iri) => ({
      label: iri,
      kind: CompletionItemKind.EnumMember,
      sortText: candidates.some((tkn) => isIriRef(tkn.nextTokenType.tokenName))
        ? `2${iri}` // number prefix used to force ordering of suggestions to user
        : null,
      textEdit: this.replaceTokenAtCursor({
        document,
        tokenAtCursor,
        replacement: iri,
      }),
    }));

    // Unlike the previous completion types, sparqlKeywords only appear in dropdown if they're valid
    const keywordCompletions = uniqBy(
      candidates.filter(
        (item) =>
          item.nextTokenType.tokenName !== tokenAtCursor.image &&
          item.nextTokenType.tokenName in sparqlKeywords
      ),
      (completionCandidate: CompletionCandidate) =>
        regexPatternToString(completionCandidate.nextTokenType.PATTERN)
    ).map((completionCandidate: CompletionCandidate) => {
      const keywordString = regexPatternToString(
        completionCandidate.nextTokenType.PATTERN
      );
      return {
        label: keywordString,
        kind: CompletionItemKind.Keyword,
        textEdit: this.replaceTokenAtCursor({
          document,
          tokenAtCursor,
          replacement: keywordString,
          replacementRange: completionCandidate.replacementRange,
        }),
      };
    });

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

    if (shouldIncludeRelationships) {
      finalCompletions.push(
        ...this.getRelationshipCompletions(document, tokenAtCursor)
      );
    }

    if (shouldIncludeTypes) {
      finalCompletions.push(
        ...this.getClassCompletions(document, tokenAtCursor)
      );
    }

    return finalCompletions;
  }

  onContentChange(
    { document }: TextDocumentChangeEvent,
    parseResult: ReturnType<
      AbstractLanguageServer<
        StardogSparqlParser | W3SpecSparqlParser
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
}
