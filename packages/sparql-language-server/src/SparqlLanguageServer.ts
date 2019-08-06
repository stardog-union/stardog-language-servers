import {
  InitializeResult,
  TextDocumentPositionParams,
  TextDocumentChangeEvent,
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  InitializeParams,
  IConnection,
  Range,
} from 'vscode-languageserver';
import {
  StardogSparqlParser,
  W3SpecSparqlParser,
  sparqlKeywords,
  sparqlTokens,
  TokenType,
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
  AbstractLanguageServer,
  CompletionCandidate,
} from 'stardog-language-utils';
import uniqBy from 'lodash.uniqby';
import { IToken } from 'chevrotain';

const ARBITRARILY_LARGE_NUMBER = 100000000000000;

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
    // `relationshipCompletionItems` and `typeCompletionItems` must be updated
    // in 2 different scenarios:
    // #1 - namespaces provided after relationshipBindings or typeBindings
    // #2 - namespaces provided before relationshipBindings or typeBindings
    // Otherwise you can find yourself with 1, both or neither reflecting the
    // namespace prefixes based on the order the updates are processed, which is
    // indeterminate.
    if (update.namespaces) {
      this.namespaceMap = namespaceArrayToObj(update.namespaces);
      if (!update.relationshipBindings && this.relationshipBindings) {
        this.relationshipCompletionItems = this.buildCompletionItemsFromData(
          this.namespaceMap,
          this.relationshipBindings.map((binding) => ({
            iri: binding.relationship.value,
            count: binding.count.value,
          }))
        );
      }
      if (!update.typeBindings && this.typeBindings) {
        this.typeCompletionItems = this.buildCompletionItemsFromData(
          this.namespaceMap,
          this.typeBindings.map((binding) => ({
            iri: binding.type.value,
            count: binding.count.value,
          }))
        );
      }
    }
    if (update.relationshipBindings) {
      this.relationshipBindings = update.relationshipBindings;
      this.relationshipCompletionItems = this.buildCompletionItemsFromData(
        this.namespaceMap,
        update.relationshipBindings.map((binding) => ({
          iri: binding.relationship.value,
          count: binding.count.value,
        }))
      );
    }
    if (update.typeBindings) {
      this.typeBindings = update.typeBindings;
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

  addLongerAltsToCandidates(
    candidates: CompletionCandidate[],
    tokens: { beforeCursor: IToken; atCursor: IToken }
  ) {
    const { beforeCursor: tokenBeforeCursor, atCursor: tokenAtCursor } = tokens;
    const combinedImage = `${tokenBeforeCursor.image}${tokenAtCursor.image}`;
    sparqlTokens.sparqlTokenTypes.forEach((token: TokenType) => {
      let isMatch = false;

      // TODO: A fuzzy search would be better than a `startsWith` here, but
      // this is good enough for now.
      if (typeof token.PATTERN === 'string') {
        isMatch = token.PATTERN.startsWith(combinedImage);
      } else {
        const { source, flags } = token.PATTERN;
        isMatch =
          source.startsWith(combinedImage) ||
          (flags.includes('i') &&
            source.toLowerCase().startsWith(combinedImage.toLowerCase()));
      }

      if (isMatch) {
        candidates.push({
          nextTokenType: token,
          replacementRange: {
            start: tokenBeforeCursor.startOffset,
            end: tokenAtCursor.endOffset + 1,
          },
          // Unfortunately, we can't compute these later values here.
          // Fortunately, we don't really need them for these purposes.
          nextTokenOccurrence: 0,
          occurrenceStack: [],
          ruleStack: [],
        });
      }
    });
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

    if (
      tokenBeforeCursor &&
      tokenAtCursor.startOffset === tokenBeforeCursor.endOffset + 1
    ) {
      // Since there is no space between this token and the previous one,
      // the character at the current position _could_ be a continuation of a
      // longer image for some other token that just hasn't been fully written
      // out yet -- e.g., when the user is typing 'strs', 'str' can match the
      // `STR` token and 's' can match the 'Unknown' token, but it's _also_
      // possible that the user was typing out `strstarts` and would like to
      // receive `STRSTARTS` as a possible token match. The check here accounts
      // for those possible longer matches. (NOTE: It doesn't seem possible to
      // do this _just_ with chevrotain. chevrotain does provide a `longer_alt`
      // property for tokens, but only ONE token can be provided as the alt. In
      // the example just described, there are _many_ longer tokens that all
      // start with 'str'.)
      this.addLongerAltsToCandidates(candidates, {
        beforeCursor: tokenBeforeCursor,
        atCursor: tokenAtCursor,
      });
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
          start: document.positionAt(tokenAtCursor.startOffset),
          end: document.positionAt(tokenAtCursor.endOffset + 1),
        };
      }

      return TextEdit.replace(textEditRange, replacement);
    };

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
        textEdit: replaceTokenAtCursor(
          keywordString,
          completionCandidate.replacementRange
        ),
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
