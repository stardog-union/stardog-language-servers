import { getWorkerConnection } from 'stardog-language-utils';
import { SparqlLanguageServer } from "./SparqlLanguageServer";

const connection = getWorkerConnection();
const server = new SparqlLanguageServer(connection);
server.start();
connection.onShutdown(self.close);
