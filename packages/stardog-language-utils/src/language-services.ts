import { IToken, TokenType } from 'millan';
import uniqBy from 'lodash.uniqby';
import { CompletionItemKind } from 'vscode-languageserver';
import { ARBITRARILY_LARGE_NUMBER } from './constants';

export const regexPatternToString = (pattern: RegExp | string) =>
  pattern
    .toString()
    .split('/')[1]
    .replace(' +', ' '); // this may be flakey. the sparql phrases "Insert Data", "Delete Where", etc. have a "+" in their regexps in millan

export const makeFilterUniqueTokensByType = (
  typeTester: (tokenName: string) => boolean
) => (tokens: IToken[]) =>
  uniqBy(
    tokens
      .filter((tkn) => typeTester(tkn.tokenType.tokenName))
      .map((tkn) => tkn.image)
  );

export const isVar = (tokenName: string) =>
  tokenName === 'VAR1' || tokenName === 'VAR2';
export const isPrefix = (tokenName: string) => tokenName === 'PNAME_NS';
export const isLocalName = (tokenName: string) => tokenName === 'PNAME_LN';
export const isIriRef = (tokenName: string) => tokenName === 'IRIREF';

export const getUniqueIdentifiers = (tokens: IToken[]) => ({
  vars: makeFilterUniqueTokensByType(isVar)(tokens),
  prefixes: makeFilterUniqueTokensByType(isPrefix)(tokens),
  localNames: makeFilterUniqueTokensByType(isLocalName)(tokens),
  iris: makeFilterUniqueTokensByType(isIriRef)(tokens),
});

export const getTokenTypesForCategory = (
  categoryName: string,
  allTokens: TokenType[]
) =>
  allTokens.filter((tokenType) =>
    Boolean(
      tokenType.CATEGORIES &&
        tokenType.CATEGORIES.some(
          (category) => category.tokenName === categoryName
        )
    )
  );

export const makeCompletionItemFromPrefixedNameAndNamespaceIri = (
  prefixedName: string,
  namespaceIri: string
) => ({
  label: prefixedName,
  kind: CompletionItemKind.Field,

  // here we take the difference of an arbitrarily large number and the iri's count which allows us to invert the
  // sort order of the items to be highest count number first. "00" is appended to ensure precedence over full iri,
  // suggestions
  sortText: `00${ARBITRARILY_LARGE_NUMBER}${prefixedName}`,

  // here we concatenate both the full iri and the prefixed iri so that users who begin typing
  // the full iri will see the prefixed alternative
  filterText: `<${namespaceIri}>${prefixedName}`,
});
