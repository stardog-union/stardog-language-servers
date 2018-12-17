import { getCliConnection } from 'stardog-language-utils';
import { SparqlLanguageServer } from 'SparqlLanguageServer';

const connection = getCliConnection('Sparql');
const server = new SparqlLanguageServer(connection);
server.start();
