import { getCliConnection } from 'stardog-language-utils';
import { TrigLanguageServer } from './TrigLanguageServer';

const connection = getCliConnection('Trig');
const server = new TrigLanguageServer(connection);
server.start();
