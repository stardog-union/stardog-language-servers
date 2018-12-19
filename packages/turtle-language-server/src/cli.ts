import { getCliConnection } from 'stardog-language-utils';
import { TurtleLanguageServer } from './TurtleLanguageServer';

const connection = getCliConnection('Turtle');
const server = new TurtleLanguageServer(connection);
server.start();
