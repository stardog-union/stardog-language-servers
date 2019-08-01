import { CstNode, IToken } from 'millan';

interface InternalParseStateManagerStateForUri {
  latestCst?: CstNode;
  latestTokens?: IToken[];
}

export const getParseStateManager = () => {
  const state: { [uri: string]: InternalParseStateManagerStateForUri } = {};

  return {
    getParseStateForUri: (uri: string): ParseState => {
      const stateForUri =
        state[uri] || ({} as InternalParseStateManagerStateForUri);

      return {
        cst: stateForUri.latestCst,
        tokens: stateForUri.latestTokens,
      };
    },

    saveParseStateForUri(uri, nextParseState: Partial<ParseState> = {}) {
      if (!state[uri]) {
        state[uri] = {};
      }

      Object.keys(nextParseState).forEach((key) => {
        const stateKey = `latest${key[0].toUpperCase()}${key.slice(1)}`;
        state[uri][stateKey] = nextParseState[key];
      });
    },

    clearParseStateForUri(uri: string) {
      state[uri] = {};
    },
  };
};

export interface ParseState {
  cst: CstNode;
  tokens?: IToken[];
}

export type ParseStateManager = ReturnType<typeof getParseStateManager>;
