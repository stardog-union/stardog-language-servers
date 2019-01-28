import { getCliConnection } from 'stardog-language-utils';
import { SrsLanguageServer } from './SrsLanguageServer';

const connection = getCliConnection('Srs');
const server = new SrsLanguageServer(connection);
server.start();
