import { getWorkerConnection } from 'stardog-language-utils';
import { SmsLanguageServer } from "SmsLanguageServer";

const connection = getWorkerConnection();
const server = new SmsLanguageServer(connection);
server.start();
connection.onShutdown(self.close);