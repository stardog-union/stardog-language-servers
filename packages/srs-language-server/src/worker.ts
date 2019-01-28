import { getWorkerConnection } from 'stardog-language-utils';
import { SrsLanguageServer } from './SrsLanguageServer';

const connection = getWorkerConnection();
const server = new SrsLanguageServer(connection);
server.start();
connection.onExit(self.close);
