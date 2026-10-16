// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js registers every handler BEFORE
// connect(), and delegates to the SolcastApp of src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR;
// and TZ, the time zone of Gladys ("today" and "tomorrow" are its days).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { SolcastApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const { version } = JSON.parse(
  readFileSync(new URL('./gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const gladys = new GladysIntegration();
const app = new SolcastApp({
  gladys,
  userAgent: `gladys-solcast/${version} (+https://github.com/LM1LC3N7/gladys-solcast)`,
});

registerHandlers(gladys, app, logger);
gladys.handleShutdown(() => app.stop());

logger.info(`Starting the Solcast integration (time zone ${app.timeZone})...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
