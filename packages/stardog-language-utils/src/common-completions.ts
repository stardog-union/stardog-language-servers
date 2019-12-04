import { makeCompletionItemFromPrefixedNameAndNamespaceIri } from './language-services';
import { CompletionItem } from 'vscode-languageserver';
import memoize from 'memoize-one';

interface CompletionDatum {
  namespaceIri: string;
  datatypes: string[];
  classes: string[];
  properties: string[];
}

const rdf: CompletionDatum = {
  namespaceIri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  datatypes: ['HTML', 'langString', 'PlainLiteral', 'XMLLiteral'],
  classes: ['Property', 'Statement', 'Bag', 'Seq', 'Alt', 'List', 'nil'],
  properties: [
    'type',
    'subject',
    'predicate',
    'object',
    'value',
    'first',
    'rest',
  ],
};

const rdfs: CompletionDatum = {
  namespaceIri: 'http://www.w3.org/2000/01/rdf-schema#',
  datatypes: [],
  classes: [
    'Resource',
    'Class',
    'Literal',
    'Container',
    'ContainerMembershipProperty',
    'Datatype',
  ],
  properties: [
    'subClassOf',
    'subPropertyOf',
    'comment',
    'label',
    'domain',
    'range',
    'seeAlso',
    'isDefinedBy',
    'member',
  ],
};

const owl: CompletionDatum = {
  namespaceIri: 'http://www.w3.org/2002/07/owl#',
  datatypes: [],
  classes: [
    'AllDifferent',
    'AllDisjointClasses',
    'AllDisjointProperties',
    'Annotation',
    'AnnotationProperty',
    'AsymmetricProperty',
    'Axiom',
    'Class',
    'DataRange',
    'DatatypeProperty',
    'DeprecatedClass',
    'DeprecatedProperty',
    'FunctionalProperty',
    'InverseFunctionalProperty',
    'IrreflexiveProperty',
    'NamedIndividual',
    'NegativePropertyAssertion',
    'Nothing',
    'ObjectProperty',
    'Ontology',
    'OntologyProperty',
    'ReflexiveProperty',
    'Restriction',
    'SymmetricProperty',
    'TransitiveProperty',
    'Thing',
  ],
  properties: [
    'allValuesFrom',
    'annotatedProperty',
    'annotatedSource',
    'annotatedTarget',
    'assertionProperty',
    'backwardCompatibleWith',
    'bottomDataProperty',
    'bottomObjectProperty',
    'cardinality',
    'complementOf',
    'datatypeComplementOf',
    'deprecated',
    'differentFrom',
    'disjointUnionOf',
    'disjointWith',
    'distinctMembers',
    'equivalentClass',
    'equivalentProperty',
    'hasKey',
    'hasSelf',
    'hasValue',
    'imports',
    'incompatibleWith',
    'intersectionOf',
    'inverseOf',
    'maxCardinality',
    'maxQualifiedCardinality',
    'members',
    'minCardinality',
    'minQualifiedCardinality',
    'onClass',
    'onDataRange',
    'onDatatype',
    'oneOf',
    'onProperties',
    'onProperty',
    'priorVersion',
    'propertyChainAxiom',
    'propertyDisjointWith',
    'qualifiedCardinality',
    'sameAs',
    'someValuesFrom',
    'sourceIndividual',
    'targetIndividual',
    'targetValue',
    'topDataProperty',
    'topObjectProperty',
    'unionOf',
    'versionInfo',
    'versionIRI',
    'withRestrictions',
  ],
};

const xsd: CompletionDatum = {
  namespaceIri: 'http://www.w3.org/2001/XMLSchema#',
  datatypes: [
    'ENTITIES',
    'ENTITY',
    'ID',
    'IDREF',
    'IDREFS',
    'NCName',
    'NMTOKEN',
    'NMTOKENS',
    'NOTATION',
    'Name',
    'QName',
    'anyAtomicType',
    'anySimpleType',
    'anyType',
    'anyURI',
    'base64Binary',
    'boolean',
    'byte',
    'date',
    'dateTime',
    'dateTimeStamp',
    'dayTimeDuration',
    'decimal',
    'double',
    'duration',
    'float',
    'gDay',
    'gMonth',
    'gMonthDay',
    'gYear',
    'gYearMonth',
    'hexBinary',
    'int',
    'integer',
    'language',
    'long',
    'negativeInteger',
    'nonNegativeInteger',
    'nonPositiveInteger',
    'normalizedString',
    'positiveInteger',
    'short',
    'string',
    'time',
    'token',
    'unsignedByte',
    'unsignedInt',
    'unsignedLong',
    'unsignedShort',
    'yearMonthDuration',
  ],
  classes: [],
  properties: [],
};

const commonCompletionData = {
  owl,
  rdf,
  rdfs,
  xsd,
};

export const getCommonCompletionItemsGivenNamespaces = memoize(
  (namespaceMap) => {
    return Object.keys(commonCompletionData).reduce(
      (acc, key) => {
        const {
          namespaceIri,
          classes = [],
          properties = [],
        } = commonCompletionData[key] as CompletionDatum;
        // Allow namespaceMap to override standard prefixes for these namespaces:
        const prefix =
          Object.keys(namespaceMap).find(
            (nsPrefix) => namespaceMap[nsPrefix] === namespaceIri
          ) || key;
        const classCompletions: CompletionItem[] = classes.map((className) =>
          makeCompletionItemFromPrefixedNameAndNamespaceIri(
            `${prefix}:${className}`,
            namespaceIri
          )
        );
        const propertyCompletions: CompletionItem[] = properties.map(
          (propertyName) =>
            makeCompletionItemFromPrefixedNameAndNamespaceIri(
              `${prefix}:${propertyName}`,
              namespaceIri
            )
        );

        return {
          classes: [...acc.classes, ...classCompletions],
          properties: [...acc.properties, ...propertyCompletions],
        };
      },
      {
        classes: [] as CompletionItem[],
        properties: [] as CompletionItem[],
      }
    );
  }
);
