'use strict';

const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Patient follow-up API listening on :${config.port} (${config.env})`);
  if (!config.apiKey) console.warn('[security] API_KEY is not set: the API is open. Set it in production.');
  if (!config.geminiApiKey) console.warn('[ai] GEMINI_API_KEY not set: drafts use the mock generator.');
});

// Graceful shutdown so in-flight requests finish and the DB closes cleanly.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
