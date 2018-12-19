import { join, resolve } from 'path';
import { testInitHandshakeForAllTransports } from '../../../utils/testUtils';

const server = resolve(join(__dirname, '..', 'src', 'cli.ts'));
testInitHandshakeForAllTransports(server);
