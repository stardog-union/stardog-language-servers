import escape from 'escape-string-regexp';
import { matchers } from 'millan';

// The PN_LOCAL_ESC regexp imported from millan includes the escape backslash,
// i.e. /\\[special chars here...]/
// In these utils we want to search for unescaped special chars and escape them
// and so the regexp is modified to remove the backslash, i.e. /[special chars here...]/
const LOCAL_ESC_CHARS = new RegExp(matchers.PN_LOCAL_ESC.source.slice(2), 'g');

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
    const escapedLocalName = localName.replace(LOCAL_ESC_CHARS, '\\$&');
    // If newIri still equals oldIri, we know that this is the first match.
    // Otherwise, if the new result is shorter than the previous result, we
    // prefer the new because it is necessarily more specific.
    if (newIri === oldIri || escapedLocalName.length < newIri.length) {
      return `${alias}:${escapedLocalName}`;
    }
  }
  return newIri;
};

export const abbreviatePrefixArray = (
  oldIri: string,
  namespaces: string[] = []
): string =>
  // No need to run the reduce if we know it'll never match.
  !oldIri
    ? oldIri
    : namespaces.reduce(
        // Starting with the old IRI, go through each prefix in the namespaces
        // object and try to replace the prefix with its alias in the
        // IRI string.

        // TODO Can there ever be multiple prefixes in a column? If not, we should
        // break the reduce once replace is successful.
        (newIri, row) => {
          const [alias, prefix] = row.split('=');
          return abbreviate(prefix, alias, oldIri, newIri);
        },
        oldIri
      );

export const abbreviatePrefixObj = (
  oldIri: string,
  namespaces: {
    [alias: string]: string;
  }
): string =>
  Object.keys(namespaces).reduce((newIri, alias) => {
    const prefix = namespaces[alias];
    return abbreviate(prefix, alias, oldIri, newIri);
  }, oldIri);

export const namespaceObjToArray = (obj) =>
  Object.keys(obj).map((alias) => {
    const prefix = obj[alias];
    return `${alias}=${prefix}`;
  });

export const namespaceArrayToObj = (array) =>
  array.reduce((acc, row) => {
    const [alias, prefix] = row.split('=');
    return {
      ...acc,
      [alias]: prefix,
    };
  }, {});
