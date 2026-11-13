'use strict';

const path = require('path');

// Load .env if present (Node >= 20.12). Real environment variables always win.
if (process.env.NODE_ENV !== 'test') try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'patients.db'),
  // Timezone that defines "today" for follow-up due dates (IANA name).
  timezone: process.env.CLINIC_TIMEZONE || 'Asia/Kolkata',
  clinicName: process.env.CLINIC_NAME || 'Sunrise Family Clinic',
  // Optional shared secret. When set, every /api request must send `x-api-key`.
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '', // empty = same-origin only
  rateLimitPerMin: int(process.env.RATE_LIMIT_PER_MIN, 120),
  // AI provider (optional). Without a key the app falls back to a clearly-labelled mock.
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gemini-2.5-flash',
  aiTimeoutMs: int(process.env.AI_TIMEOUT_MS, 15000),
};
