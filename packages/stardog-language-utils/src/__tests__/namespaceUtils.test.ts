import {
  splitNamespace,
  abbreviatePrefixArray,
  namespaceObjToArray,
  namespaceArrayToObj,
  abbreviatePrefixObj,
  unescapeString,
} from '../namespaceUtils';

describe('splitNamespace', () => {
  it('splits a namespace into a string array of the alias and prefix', () => {
    const namespace = 'foo=http://foo.org/';
    const [alias, prefix] = splitNamespace(namespace);
    expect(alias).toBe('foo');
    expect(prefix).toBe('http://foo.org/');
  });
  it('splits a namespace containing or ending with "=" into a string array of the alias and prefix', () => {
    const namespace = 'foo=http://foo.org/dog=cat=';
    const [alias, prefix] = splitNamespace(namespace);
    expect(alias).toBe('foo');
    expect(prefix).toBe('http://foo.org/dog=cat=');
  });
});

describe('namespaceObjToArray', () => {
  it('transforms a namespace obj to an array of "=" separated prefix/alias strings', () => {
    const namespaceObj = {
      foo: 'http://foo.org/',
      dog: 'http://dog.gov/',
      cat: 'http://cat.ru/',
    };
    expect(namespaceObjToArray(namespaceObj)).toMatchObject([
      'foo=http://foo.org/',
      'dog=http://dog.gov/',
      'cat=http://cat.ru/',
    ]);
  });
});

describe('namespaceArrayToObj', () => {
  it('transforms a namespace array to an object', () => {
    const namespaceArray = [
      'foo=http://foo.org/',
      'dog=http://dog.gov/',
      'cat=http://cat.ru/',
    ];
    expect(namespaceArrayToObj(namespaceArray)).toMatchObject({
      foo: 'http://foo.org/',
      dog: 'http://dog.gov/',
      cat: 'http://cat.ru/',
    });
  });
});

describe('abbreviatePrefixArray and abbreviatePrefixObj', () => {
  const testArrayAndObj = (iri, namespaceArray, expectation) => {
    expect(abbreviatePrefixArray(iri, namespaceArray)).toBe(expectation);
    expect(abbreviatePrefixObj(iri, namespaceArrayToObj(namespaceArray))).toBe(
      expectation
    );
  };
  it('abbreviates IRIs that match a namespace', () => {
    const namespaces = [
      'foo=http://foo.org/',
      'buzztroll=http://www.buzz.edu/troll#',
    ];
    const fooBar = 'http://foo.org/bar';
    const buzzTrollBoom = 'http://www.buzz.edu/troll#boom';
    testArrayAndObj(fooBar, namespaces, 'foo:bar');
    testArrayAndObj(buzzTrollBoom, namespaces, 'buzztroll:boom');
  });
  it('returns the most specific match of several matches', () => {
    const namespaces = [
      'foo=http://foo.org/',
      'bar=http://foo.org/bar/',
      'fizz=http://foo.org/bar/fizz/',
    ];
    const namespaces1 = [
      'foo=http://foo.org/',
      'fizz=http://foo.org/bar/fizz/',
      'bar=http://foo.org/bar/',
    ];
    testArrayAndObj('http://foo.org/bar/fizz/buzz', namespaces, 'fizz:buzz');
    testArrayAndObj('http://foo.org/bar/fizz/buzz', namespaces1, 'fizz:buzz');
  });
  it('removes ecape characters when abbreviating IRIs', () => {
    const namespaces = ['foo=http://foo.org/'];
    testArrayAndObj(
      'http://foo.org/bar/fizz/buzz_!&?#@%.',
      namespaces,
      'foo:bar/fizz/buzz_!&?#@%.'
    );
  });
});

describe('unescapeString', () => {
  it('unescaped a string with escaped 4 digit unicode sequences', () => {
    const string = 'S\\u0045LECT * \\u007B ?s ?p ?o \\u007D';
    expect(unescapeString(string).unescapedString).toMatch(
      'SELECT * { ?s ?p ?o }'
    );
  });
});
