import { CstNode, IToken } from 'millan';

export const getParseStateManager = () => {
  const latestCstByUri: {
    [uri: string]: CstNode;
  } = {};
  const latestTokensByUri: {
    [uri: string]: IToken[];
  } = {};

  return {
    getParseStateForUri: (uri: string): ParseState => ({
      cst: latestCstByUri[uri],
      tokens: latestTokensByUri[uri],
    }),

    saveParseStateForUri(uri, { cst, tokens }: ParseState) {
      latestCstByUri[uri] = cst;
      latestTokensByUri[uri] = tokens;
    },

    clearParseStateForUri(uri: string) {
      latestCstByUri[uri] = undefined;
      latestTokensByUri[uri] = undefined;
    },
  };
};

export interface ParseState {
  cst: CstNode;
  tokens?: IToken[];
}

export type ParseStateManager = ReturnType<typeof getParseStateManager>;
