import { getWorkerConnection } from 'stardog-language-utils';
import { TurtleLanguageServer } from './TurtleLanguageServer';

const connection = getWorkerConnection();
const server = new TurtleLanguageServer(connection);
server.start();
connection.onExit(self.close);
