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
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  abbreviatePrefixObj,
  namespaceArrayToObj,
  LSPExtensionMethod,
  SparqlCompletionData,
  AbstractLanguageServer,
  CompletionCandidate,
  ARBITRARILY_LARGE_NUMBER,
} from 'stardog-language-utils';
import {
  ISemanticError,
  TokenType,
  graphQlTokens,
  graphQlUtils,
  IToken,
  StandardGraphQlParser,
  StardogGraphQlParser,
} from 'millan';

const { stardogGraphQlTokenMap, stardogGraphQlTokens } = graphQlTokens;
const SPARQL_ERROR_PREFIX = 'SPARQL Error: ';
const GRAPHQL_VALUE_TYPES = ['Int', 'Float', 'String', 'Boolean', 'Null'];

const is = (tokenType: TokenType, name: string) =>
  tokenType.CATEGORIES.some((categoryToken) => categoryToken.name === name);

const partitionTokenTypesByLevel = (
  filter: (tokenType: TokenType) => Boolean
) => {
  const partitioned = {
    topLevel: [] as TokenType[],
    notTopLevel: [] as TokenType[],
  };
  stardogGraphQlTokens.filter(filter).forEach((tokenType: TokenType) => {
    const level: keyof typeof partitioned = is(
      tokenType,
      stardogGraphQlTokenMap.TopLevel.name
    )
      ? 'topLevel'
      : 'notTopLevel';
    partitioned[level].push(tokenType);
  });
  return partitioned;
};

const stardogSpecificDirectives = partitionTokenTypesByLevel(
  (tokenType) =>
    tokenType === stardogGraphQlTokenMap.TypeToken ||
    tokenType.CATEGORIES.includes(stardogGraphQlTokenMap.StardogDirective)
);
const stardogSpecificArguments = partitionTokenTypesByLevel(
  (tokenType) =>
    tokenType === stardogGraphQlTokenMap.Skip ||
    tokenType.CATEGORIES.includes(stardogGraphQlTokenMap.StardogArgument)
);
const stardogSpecificArgumentNames = stardogSpecificArguments.topLevel
  .concat(stardogSpecificArguments.notTopLevel)
  .map((tokenType) => tokenType.PATTERN as string);

@autoBindMethods
export class GraphQlLanguageServer extends AbstractLanguageServer<
  StardogGraphQlParser | StandardGraphQlParser
> {
  protected parser: StardogGraphQlParser | StandardGraphQlParser;
  private namespaceMap: { [alias: string]: string } = {};
  private relationshipBindings: SparqlCompletionData['relationshipBindings'] = [];
  private relationshipCompletionItems: CompletionItem[] = [];
  private typeBindings: SparqlCompletionData['typeBindings'] = [];
  private typeCompletionItems: CompletionItem[] = [];
  private graphQLValueTypeBindings: SparqlCompletionData['graphQLValueTypeBindings'] = [];
  private graphQLTypeCompletionItems: CompletionItem[] = [];

  constructor(connection: IConnection) {
    // Like the SPARQL server, the GraphQl server instantiates a different parser
    // depending on initialization params
    super(connection, null);
    this.graphQLTypeCompletionItems = this.buildGraphQLTypeCompletionItems(
      this.namespaceMap,
      this.graphQLValueTypeBindings
    );
  }

  onInitialization(params: InitializeParams): InitializeResult {
    this.connection.onCompletion(this.handleCompletion);
    this.connection.onNotification(
      LSPExtensionMethod.DID_UPDATE_COMPLETION_DATA,
      this.handleUpdateCompletionData
    );

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
          triggerCharacters: ['$', '@'],
        },
        hoverProvider: true,
      },
    };
  }

  handleUpdateCompletionData(update: SparqlCompletionData) {
    // completion items must be updated in 2 different scenarios:
    // #1 - namespaces provided after bindings
    // #2 - namespaces provided before bindings
    // Otherwise you can find yourself with the items not reflecting the namespace
    // prefixes based on the order the updates are processed, which is indeterminate.
    if (update.namespaces) {
      this.namespaceMap = namespaceArrayToObj(update.namespaces);
    }
    if (update.relationshipBindings || update.namespaces) {
      this.relationshipBindings =
        update.relationshipBindings || this.relationshipBindings;
      this.relationshipCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        this.relationshipBindings.map((binding) => ({
          iri: binding.relationship.value,
          count: binding.count.value,
        })),
        CompletionItemKind.Field
      );
    }
    if (update.typeBindings || update.namespaces) {
      this.typeBindings = update.typeBindings || this.typeBindings;
      this.typeCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        this.typeBindings.map((binding) => ({
          iri: binding.type.value,
          count: binding.count.value,
        })),
        CompletionItemKind.EnumMember
      );
    }
    if (update.graphQLValueTypeBindings || update.namespaces) {
      this.graphQLValueTypeBindings =
        update.graphQLValueTypeBindings || this.graphQLValueTypeBindings;
      this.graphQLTypeCompletionItems = this.buildGraphQLTypeCompletionItems(
        this.namespaceMap,
        this.graphQLValueTypeBindings
      );
    }
  }

  buildCompletionItemsFromData(
    namespaceMap: { [alias: string]: string },
    irisAndCounts: { iri: string; count: string }[],
    kind: CompletionItemKind
  ): CompletionItem[] {
    // GraphQL cannot idenfy non-prefixed IRIs as fields, so we want to ignore non-prefixed bindings
    const prefixed: CompletionItem[] = [];

    if (!Object.keys(namespaceMap).length) {
      return prefixed;
    }

    irisAndCounts.forEach(({ iri, count }) => {
      const prefixedIri = abbreviatePrefixObj(iri, namespaceMap);
      if (prefixedIri !== iri) {
        // in GraphQL, the `:` character cannot be used in field names so instead Stardog uses the `_` character
        const graphQLIri = prefixedIri.replace(/\:/g, '_');
        const alphaSortTextForCount =
          ARBITRARILY_LARGE_NUMBER - parseInt(count, 10);
        prefixed.push({
          // namespaces with a blank prefix do not require the leading underscore
          // so a prefixed iri of `:Type` can be written as `Type` instead of `_Type`
          label: graphQLIri.slice(graphQLIri.startsWith('_') ? 1 : 0),
          kind,

          // take the difference of an arbitrarily large number and the iri's count which
          // allows us to invert the sort order of the items to be highest count number first
          sortText: `${kind}-${alphaSortTextForCount}${graphQLIri}`,

          // concatenate both the full iri and the prefixed iri so that users who begin
          // typing the full or prefixed iri will see the graphql alternative
          filterText: `${iri}${prefixedIri}${graphQLIri}`,
          detail: `${count} occurrences`,
        });
      }
    });

    return prefixed;
  }

  buildGraphQLTypeCompletionItems(
    namespaceMap: { [alias: string]: string },
    typesAndIris: { type: string; iri: string }[]
  ): CompletionItem[] {
    return GRAPHQL_VALUE_TYPES.map((graphQLType) => {
      const completionItem: CompletionItem = {
        label: graphQLType,
        kind: CompletionItemKind.Enum,
      };
      const typeAndIri = typesAndIris.find((t) => t.type === graphQLType);
      if (typeAndIri && Object.keys(namespaceMap).length) {
        const { iri } = typeAndIri;
        const prefixedIri = abbreviatePrefixObj(iri, namespaceMap);
        completionItem.filterText = `${graphQLType}<${iri}>${prefixedIri}`;
      }
      return completionItem;
    });
  }

  private addStardogSpecificDirectivesToCompletionCandidates(
    candidates: CompletionCandidate[]
  ) {
    // Find the candidate, if any, that is at the spot where a directive name
    // is valid.
    const directiveCandidate = candidates.find(
      (candidate) =>
        candidate.ruleStack[candidate.ruleStack.length - 1] === 'Directive' &&
        candidate.nextTokenType.name !== stardogGraphQlTokenMap.At.name
    );

    if (!directiveCandidate) {
      return;
    }

    const isTopLevel = !directiveCandidate.ruleStack.includes('SelectionSet');
    const stardogSpecificDirectivesForLevel =
      stardogSpecificDirectives[isTopLevel ? 'topLevel' : 'notTopLevel'];

    stardogSpecificDirectivesForLevel.forEach((stardogSpecificDirective) =>
      candidates.push({
        ...directiveCandidate,
        nextTokenType: stardogSpecificDirective,
      })
    );
  }

  private addStardogSpecificArgumentsToCompletionCandidates(
    candidates: CompletionCandidate[],
    tokenVectorForContentAssist: IToken[]
  ) {
    // Find the candidate, if any, that is at the spot where an Argument Alias
    // is valid.
    const argumentAliasCandidate = candidates.find(
      ({ nextTokenType, ruleStack }) => {
        const ruleStackLength = ruleStack.length;
        return (
          !is(nextTokenType, 'Punctuator') &&
          ruleStack[ruleStackLength - 1] === 'Alias' &&
          ruleStack[ruleStackLength - 2] === 'Argument'
        );
      }
    );

    if (!argumentAliasCandidate) {
      return;
    }

    const isDirectiveArgument =
      argumentAliasCandidate.ruleStack.slice(-4).join('/') ===
      'Directive/Arguments/Argument/Alias';

    if (isDirectiveArgument) {
      let containingStardogDirective: IToken;
      let parensStackCount = 1;

      // Walk back through the tokens until we find the Stardog directive for
      // which the currently located candidate is an argument (using parens
      // matching).
      for (
        let i = tokenVectorForContentAssist.length - 1;
        i >= 0 || parensStackCount < 0;
        i--
      ) {
        const currentToken = tokenVectorForContentAssist[i];
        if (
          currentToken.tokenType.name === stardogGraphQlTokenMap.LParen.name
        ) {
          parensStackCount--;
        } else if (
          currentToken.tokenType.name === stardogGraphQlTokenMap.RParen.name
        ) {
          parensStackCount++;
        }
        if (
          is(
            currentToken.tokenType,
            stardogGraphQlTokenMap.StardogDirective.name
          ) &&
          parensStackCount === 0
        ) {
          // When we have no extraneous parentheses and we've found a Stardog
          // directive, we know we've got the Stardog-specific directive for
          // which the candidate is an argument.
          containingStardogDirective = currentToken;
          break;
        }
      }

      if (!containingStardogDirective) {
        return;
      }

      // Get the allowed argument aliases for the located Stardog-specific
      // directive, and add them to the completion candidates.
      const argumentAliasTokenTypes = graphQlUtils.getArgumentTokenTypesForDirectiveNameToken(
        containingStardogDirective
      );
      argumentAliasTokenTypes.forEach((argumentAliasTokenType) =>
        candidates.push({
          ...argumentAliasCandidate,
          nextTokenType: argumentAliasTokenType,
        })
      );
    } else {
      // Non-directive argument.
      const isTopLevel = argumentAliasCandidate.ruleStack.includes(
        'SelectionSet'
      );
      const stardogSpecificArgumentsForLevel =
        stardogSpecificArguments[isTopLevel ? 'topLevel' : 'notTopLevel'];

      stardogSpecificArgumentsForLevel.forEach((stardogSpecificArgument) =>
        candidates.push({
          ...argumentAliasCandidate,
          nextTokenType: stardogSpecificArgument,
        })
      );
    }
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

    const cursorOffset = document.offsetAt(params.position);
    const tokenAtCursor = tokens.find(
      (token) =>
        token.startOffset <= cursorOffset &&
        token.endOffset !== token.startOffset &&
        token.endOffset >= cursorOffset
    );
    const tokenIdxAtOrAfterCursor = tokenAtCursor
      ? tokens.indexOf(tokenAtCursor)
      : tokens.findIndex((token) => token.startOffset >= cursorOffset);
    const tokenBeforeCursor =
      tokens[
        (tokenIdxAtOrAfterCursor !== -1
          ? tokenIdxAtOrAfterCursor
          : tokens.length) - 1
      ];
    const isNameTokenImmediatelyBeforeCursor =
      tokenBeforeCursor &&
      tokenBeforeCursor.endOffset === cursorOffset - 1 &&
      tokenBeforeCursor.tokenType.name === 'Name';
    // If a Name token is immediately before the cursor, then we don't include
    // it as part of the token vector for content assistance, since the user
    // may still be writing the rest of the Name.
    const tokenVectorForContentAssist = isNameTokenImmediatelyBeforeCursor
      ? tokens.slice(0, tokens.indexOf(tokenBeforeCursor))
      : tokens.slice(
          0,
          tokenIdxAtOrAfterCursor !== -1
            ? tokenIdxAtOrAfterCursor
            : tokens.length
        );
    const candidates: CompletionCandidate[] = this.parser.computeContentAssist(
      'Document',
      tokenVectorForContentAssist
    );

    if (tokenVectorForContentAssist.length > 0) {
      // These candidates are relevant only after at least one token.
      this.addStardogSpecificDirectivesToCompletionCandidates(candidates);

      // We need to deal here with the literal text rather than just the tokens
      // because commas are ignored in GraphQL.
      const firstNonWhitespaceBeforeCursor = document
        .getText()
        .slice(0, cursorOffset)
        .trim()
        .slice(-1);

      // Argument aliases can appear after a parenthesis or a comma or as the
      // continuation of a Name token.
      if (
        firstNonWhitespaceBeforeCursor ===
          stardogGraphQlTokenMap.Comma.PATTERN ||
        tokenBeforeCursor.tokenType === stardogGraphQlTokenMap.LParen ||
        (isNameTokenImmediatelyBeforeCursor &&
          stardogSpecificArgumentNames.some((argName) =>
            argName.startsWith(tokenBeforeCursor.image)
          ))
      ) {
        this.addStardogSpecificArgumentsToCompletionCandidates(
          candidates,
          tokenVectorForContentAssist
        );
      }
    }

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
          start: tokenAtCursor
            ? document.positionAt(tokenAtCursor.startOffset)
            : document.positionAt(cursorOffset),
          end: tokenAtCursor
            ? document.positionAt(tokenAtCursor.endOffset + 1)
            : document.positionAt(cursorOffset),
        };
      }

      return TextEdit.replace(textEditRange, replacement);
    };

    // Completions are collected in this way (pushing, etc.) for
    // speed/complexity reasons (fewer map/filter/flatten operations needed).
    const allCompletions: CompletionItem[] = [];

    let hasFieldCandidate = false;
    let hasNamedTypeCandidate = false;
    let includeTypeCompletions = false;
    let includeGraphQLTypeCompletions = false;

    candidates.forEach((candidate) => {
      // Don't include punctuation in completion results.
      if (is(candidate.nextTokenType, 'Punctuator')) {
        return;
      }

      // for name tokens, check the context and then use the name completion items
      if (isNameTokenImmediatelyBeforeCursor) {
        const lastIdx = candidate.ruleStack.length - 1;
        if (candidate.ruleStack[lastIdx] === 'Field') {
          hasFieldCandidate = true;
        } else if (candidate.ruleStack[lastIdx] === 'NamedType') {
          hasNamedTypeCandidate = true;
          switch (candidate.ruleStack[lastIdx - 1]) {
            case 'TypeCondition':
            case 'ImplementsInterfaces':
            case 'UnionMemeberTypes': {
              includeTypeCompletions = true;
              break;
            }
            case 'Type': {
              for (let idx = lastIdx - 2; idx >= 0; idx--) {
                // variables can only be input types (not type bindings)
                if (candidate.ruleStack[idx] === 'VariableDefinition') {
                  includeGraphQLTypeCompletions = true;
                  break;
                }
                // field definitions found in interface type extensions
                // and input definitions can be composed of either graphql
                // types or the type bindings
                if (
                  candidate.ruleStack[idx] === 'FieldDefinition' ||
                  candidate.ruleStack[idx] === 'InputValueDefinition'
                ) {
                  includeTypeCompletions = true;
                  includeGraphQLTypeCompletions = true;
                  break;
                }
              }
              break;
            }
          }
        }
      }

      const completionItem = this.getCompletionItem(
        candidate,
        replaceTokenAtCursor
      );

      if (!completionItem) {
        return;
      }

      if (!isNameTokenImmediatelyBeforeCursor) {
        allCompletions.push(completionItem);
      } else if (completionItem.label.startsWith(tokenBeforeCursor.image)) {
        // If a Name token is immediately before the cursor, we only add
        // candidates that start with the text of that name (since the user may
        // still be typing the rest of the name). If the user accepts one of
        // those candidates, it should replace the full Name token before the
        // cursor.
        allCompletions.push({
          ...completionItem,
          textEdit: TextEdit.replace(
            {
              start: document.positionAt(tokenBeforeCursor.startOffset),
              end: document.positionAt(tokenBeforeCursor.endOffset),
            },
            completionItem.label
          ),
        });
      }
    });

    const hasOnlyFieldCandidate = hasFieldCandidate && !hasNamedTypeCandidate;
    // show relationship completions if the only candidate is a field
    if (hasOnlyFieldCandidate) {
      allCompletions.push(
        ...this.relationshipCompletionItems.map((item) => ({
          ...item,
          textEdit: replaceTokenAtCursor(item.label, {
            start: tokenBeforeCursor.startOffset,
            end: cursorOffset,
          }),
        }))
      );
    }
    // show type completions if the only candidate is a field
    // or the namedType candidate includes types
    if (hasOnlyFieldCandidate || includeTypeCompletions) {
      allCompletions.push(
        ...this.typeCompletionItems.map((item) => ({
          ...item,
          textEdit: replaceTokenAtCursor(item.label, {
            start: tokenBeforeCursor.startOffset,
            end: cursorOffset,
          }),
        }))
      );
    }
    // show graphql type completions if there are namedType
    // candidate and they include the graphql types
    if (hasNamedTypeCandidate && includeGraphQLTypeCompletions) {
      allCompletions.push(
        ...this.graphQLTypeCompletionItems.map((item) => ({
          ...item,
          textEdit: replaceTokenAtCursor(item.label, {
            start: tokenBeforeCursor.startOffset,
            end: cursorOffset,
          }),
        }))
      );
    }

    return uniqBy(allCompletions, 'label');
  }

  private getCompletionItem(
    candidate: CompletionCandidate,
    tokenReplacer: (
      replacement: string,
      replacementRange?: CompletionCandidate['replacementRange']
    ) => TextEdit
  ): CompletionItem | void {
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
