import * as lsp from 'vscode-languageserver';
import { autoBindMethods } from 'class-autobind-decorator';
import {
  errorMessageProvider,
  AbstractLanguageServer,
} from 'stardog-language-utils';
import { ShaclParser } from 'millan';

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
    return {
      capabilities: {
        // Tell the client that the server works in NONE text document sync mode
        textDocumentSync: this.documents.syncKind[0],
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
    debugger;
    const { uri } = document;
    const content = document.getText();
    const { errors, tokens } = parseResults;

    if (!content.length) {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: [],
      });
      return;
    }

    const lexDiagnostics = this.getLexDiagnostics(document, tokens);
    const parseDiagnostics = this.getParseDiagnostics(document, errors);

    return this.connection.sendDiagnostics({
      uri,
      diagnostics: [...lexDiagnostics, ...parseDiagnostics],
    });
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

    return finalCompletions;
  }
}
