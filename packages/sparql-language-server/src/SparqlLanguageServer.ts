import {
  InitializeResult,
  TextDocumentPositionParams,
  TextDocumentChangeEvent,
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  InitializeParams,
  IConnection,
} from 'vscode-languageserver';
import {
  StardogSparqlParser,
  W3SpecSparqlParser,
  sparqlKeywords,
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
} from 'stardog-language-utils';
import * as uniq from 'lodash.uniq';

const ARBITRARILY_LARGE_NUMBER = 100000000000000;

@autoBindMethods
export class SparqlLanguageServer extends AbstractLanguageServer<
  StardogSparqlParser | W3SpecSparqlParser
> {
  protected parser: StardogSparqlParser | W3SpecSparqlParser;
  private namespaceMap = {};
  private relationshipCompletionItems = [];
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

  handleCompletion(params: TextDocumentPositionParams): CompletionItem[] {
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
