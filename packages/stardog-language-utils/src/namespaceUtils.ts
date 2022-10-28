import escape from 'escape-string-regexp';
import { matchers } from 'millan';

const abbreviate = (
  prefix: string,
  alias: string,
  oldIri: string,
  newIri: string
): string => {
  const result = new RegExp(`^(<?)(${escape(prefix)})(\\S+?)(>?)$`).exec(
    oldIri
  );
  if (result && result[3]) {
    const localName = result[3];
    // If newIri still equals oldIri, we know that this is the first match.
    // Otherwise, if the new result is shorter than the previous result, we
    // prefer the new because it is necessarily more specific.
    if (newIri === oldIri || localName.length < newIri.length) {
      return `${alias}:${localName}`;
    }
  }
  return newIri;
};

export const splitNamespace = (namespace: string) => {
  const [alias, ...splitPrefix] = namespace.split('=');
  return [alias, splitPrefix.join('=')];
};

export const validateLocalName = (newIri) =>
  new RegExp(`^${matchers.PN_LOCAL.source}$`).test(newIri);

export const abbreviatePrefixArray = (
  oldIri: string,
  namespaces: string[] = []
): string =>
  // No need to run the reduce if we know it'll never match.
  !oldIri
    ? oldIri
    : namespaces.reduce((newIri, row) => {
        // Starting with the old IRI, go through each prefix in the namespaces
        // object and try to replace the prefix with its alias in the
        // IRI string.

        // TODO Can there ever be multiple prefixes in a column? If not, we should
        // break the reduce once replace is successful.
        const [alias, prefix] = splitNamespace(row);
        const abbreviated = abbreviate(prefix, alias, oldIri, newIri);

        // Check if local name is valid
        if (
          abbreviated !== oldIri &&
          validateLocalName(abbreviated.split(':')[1])
        )
          return abbreviated;

        return oldIri;
      }, oldIri);

export const abbreviatePrefixObj = (
  oldIri: string,
  namespaces: {
    [alias: string]: string;
  }
): string =>
  Object.keys(namespaces).reduce((newIri, alias) => {
    const prefix = namespaces[alias];
    const abbreviated = abbreviate(prefix, alias, oldIri, newIri);

    // Check if local name is valid
    if (abbreviated !== oldIri && validateLocalName(abbreviated.split(':')[1]))
      return abbreviated;

    return oldIri;
  }, oldIri);

export const namespaceObjToArray = (obj) =>
  Object.keys(obj).map((alias) => {
    const prefix = obj[alias];
    return `${alias}=${prefix}`;
  });

export const namespaceArrayToObj = (array) =>
  array.reduce((acc, row) => {
    const [alias, prefix] = splitNamespace(row);
    return {
      ...acc,
      [alias]: prefix,
    };
  }, {});
