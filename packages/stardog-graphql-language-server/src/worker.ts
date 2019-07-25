import { getWorkerConnection } from 'stardog-language-utils';
import { GraphQlLanguageServer } from './GraphQlLanguageServer';

const connection = getWorkerConnection();
const server = new GraphQlLanguageServer(connection);
server.start();
connection.onExit(self.close);
