import { getCliConnection } from 'stardog-language-utils';
import { GraphQlLanguageServer } from './GraphQlLanguageServer';

const connection = getCliConnection('GraphQl');
const server = new GraphQlLanguageServer(connection);
server.start();
