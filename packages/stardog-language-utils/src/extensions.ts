export enum LSPExtensionMethod {
  DID_UPDATE_COMPLETION_DATA = '$/didUpdateCompletionData',
}

export type SparqlCompletionData = {
  namespaces?: string[];
  relationshipBindings?: {
    relationship: {
      type: 'uri';
      value: string;
    };
    count: {
      datatype: 'http://www.w3.org/2001/XMLSchema#integer';
      type: 'literal';
      value: string;
    };
  }[];
  typeBindings?: {
    type: {
      type: 'uri';
      value: string;
    };
    count: {
      datatype: 'http://www.w3.org/2001/XMLSchema#integer';
      type: 'literal';
      value: string;
    };
  }[];
  graphQLValueTypeBindings?: {
    type: string;
    iri: string;
  }[];
};
