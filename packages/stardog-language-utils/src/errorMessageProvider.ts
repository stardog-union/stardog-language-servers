import { sparqlKeywords, TokenType } from "millan";
import { regexPatternToString } from "./language-services";

const getTokenDisplayName = (token: TokenType) => {
  if (token.LABEL) {
    return `${token.tokenName} e.g. ${token.LABEL}`;
  }
  if (typeof token.PATTERN === "string") {
    return `'${token.PATTERN}'`;
  }
  if (token.tokenName in sparqlKeywords) {
    return `'${regexPatternToString(token.PATTERN)}'`;
  }
  return token.tokenName;
};

const formatTokenPathsForDiagnostics = (paths: TokenType[][]): string =>
  paths
    .map(iterationPath =>
      iterationPath.map((token: TokenType) => getTokenDisplayName(token)).join(" ")
    )
    .join("\n ");

const buildEarlyExitMessage = options => {
  const { expectedIterationPaths, customUserDescription } = options;
  const formattedPaths = formatTokenPathsForDiagnostics(expectedIterationPaths);
  let expectationMessage = `\tExpected one of the following:\n ${formattedPaths}`;
  if (customUserDescription) {
    expectationMessage += `\n\n ${customUserDescription}`;
  }
  return expectationMessage;
};

const buildNoViableAltMessage = options => {
  const { expectedPathsPerAlt } = options;
  const formattedPathsPerAlt = expectedPathsPerAlt
    .map(alt => formatTokenPathsForDiagnostics(alt))
    .join("\n ");
  return `\tExpected one of the following:\n ${formattedPathsPerAlt}`;
};

const buildMismatchTokenMessage = options => {
  return `${getTokenDisplayName(options.expected)} expected.`;
};

const buildNotAllInputParsedMessage = () => "Expected EOF.";

export const errorMessageProvider = {
  buildEarlyExitMessage,
  buildNoViableAltMessage,
  buildMismatchTokenMessage,
  buildNotAllInputParsedMessage
};
