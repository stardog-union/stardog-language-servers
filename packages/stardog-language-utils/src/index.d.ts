import { ISyntacticContentAssistPath } from 'chevrotain';

export * from './worker';
export * from './cli';

export interface CompletionCandidate extends ISyntacticContentAssistPath {
  replacementRange?: {
    start: number;
    end: number;
  };
}
