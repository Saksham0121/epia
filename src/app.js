'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { openDb } = require('./db');
const { createPatientRepo } = require('./services/patientRepo');
const { createDraftRepo } = require('./services/draftRepo');
const { requireApiKey, requestLogger, notFound, errorHandler } = require('./middleware/common');
const patientRoutes = require('./routes/patients');
const followUpRoutes = require('./routes/followups');

/** App factory: dependencies are injectable so tests can use an in-memory DB and a fake AI. */
function createApp({ db = openDb(config.dbPath), generateDraft } = {}) {
  const patients = createPatientRepo(db);
  const drafts = createDraftRepo(db);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs for rate limiting behind a PaaS proxy
  app.use(helmet());
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',') }));
  app.use(requestLogger);
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMin,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { message: 'Too many requests, slow down' } },
    }),
    requireApiKey,
  );
  app.get('/api', (_req, res) => res.json({ name: 'Patient Follow-up API', endpoints: ENDPOINTS }));
  app.use('/api/patients', patientRoutes({ patients }));
  app.use('/api/followups', followUpRoutes({ patients, drafts, generateDraft }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(notFound);
  app.use(errorHandler);
  app.locals.db = db;
  return app;
}

const ENDPOINTS = [
  'POST   /api/patients',
  'GET    /api/patients?status=&page=&limit=',
  'GET    /api/patients/due-today?date=&includeOverdue=',
  'GET    /api/patients/:id',
  'PATCH  /api/patients/:id/follow-up',
  'POST   /api/followups/generate',
  'GET    /api/followups/drafts?status=',
  'PATCH  /api/followups/drafts/:id',
  'POST   /api/followups/drafts/:id/approve',
  'POST   /api/followups/drafts/:id/reject',
];

module.exports = { createApp };
