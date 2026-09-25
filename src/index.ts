/**
 * Application entry point.
 *
 * We use require() instead of import statements here to enforce a strict
 * initialisation order that TypeScript's import hoisting would otherwise break:
 *
 *   1. dotenv.config()        — env vars must be in process.env before anything reads them
 *   2. require('./instrumentation') — reads ARIZE_* env vars; must patch OpenAI before it loads
 *   3. require('./server')    — imports OpenAI, starts Express
 */

// 1. Load environment variables
// eslint-disable-next-line @typescript-eslint/no-require-imports
(require('dotenv') as typeof import('dotenv')).config();

// 2. Register Arize / OpenTelemetry tracing (no-op if env vars absent)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./instrumentation');

// 3. Start the server
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./server');
