import { getWorkerConnection } from 'stardog-language-utils';
import { TrigLanguageServer } from './TrigLanguageServer';

const connection = getWorkerConnection();
const server = new TrigLanguageServer(connection);
server.start();
connection.onExit(self.close);
