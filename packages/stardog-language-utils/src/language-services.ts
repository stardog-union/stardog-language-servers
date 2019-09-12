import { IToken } from 'millan';
import uniqBy from 'lodash.uniqby';

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
