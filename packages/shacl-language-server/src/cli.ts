import { getCliConnection } from 'stardog-language-utils';
import { ShaclLanguageServer } from './ShaclLanguageServer';

const connection = getCliConnection('Shacl');
const server = new ShaclLanguageServer(connection);
server.start();
