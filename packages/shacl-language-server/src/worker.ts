import { getWorkerConnection } from 'stardog-language-utils';
import { ShaclLanguageServer } from './ShaclLanguageServer';

const connection = getWorkerConnection();
const server = new ShaclLanguageServer(connection);
server.start();
connection.onExit(self.close);
