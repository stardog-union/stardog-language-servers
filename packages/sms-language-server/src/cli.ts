import { getCliConnection } from 'stardog-language-utils';
import { SmsLanguageServer } from 'SmsLanguageServer';

const connection = getCliConnection('Sms');
const server = new SmsLanguageServer(connection);
server.start();
