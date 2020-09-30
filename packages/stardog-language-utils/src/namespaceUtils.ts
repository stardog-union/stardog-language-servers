import escape from 'escape-string-regexp';

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
          const [alias, prefix] = splitNamespace(row);
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
    const [alias, prefix] = splitNamespace(row);
    return {
      ...acc,
      [alias]: prefix,
    };
  }, {});

const escapeSequence = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})/g;

export const unescapeString = (
  item: string
): { indexMap: Map<number, number>; unescapedString: string } => {
  const indexMap = new Map<number, number>();
  let unescapedString = item;
  let displaceTotal = 0;
  try {
    unescapedString = item.replace(
      escapeSequence,
      (_: string, unicode4: string, unicode8: string, offset: number) => {
        const currentIndex = offset - displaceTotal;
        const displaceNum = unicode4 ? 5 : 9;
        displaceTotal += displaceNum;

        indexMap.set(currentIndex, displaceNum);
        let charCode = parseInt(unicode8 || unicode4, 16);

        if (unicode8) {
          return String.fromCharCode(charCode);
        } else if (unicode4) {
          if (charCode <= 0xffff) {
            return String.fromCharCode(charCode);
          }
          return String.fromCharCode(
            0xd800 + (charCode -= 0x10000) / 0x400,
            0xdc00 + (charCode & 0x3ff)
          );
        }
      }
    );
  } catch (error) {}
  return { indexMap, unescapedString };
};
