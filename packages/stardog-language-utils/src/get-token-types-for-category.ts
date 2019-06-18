import { TokenType } from 'millan';

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
