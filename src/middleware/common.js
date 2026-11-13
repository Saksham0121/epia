'use strict';

const crypto = require('crypto');
const { ZodError } = require('zod');
const config = require('../config');
const { HttpError } = require('../utils');

/** Optional API-key auth (constant-time comparison). Disabled when API_KEY is unset. */
function requireApiKey(req, _res, next) {
  if (!config.apiKey) return next();
  const given = Buffer.from(String(req.get('x-api-key') || ''));
  const want = Buffer.from(config.apiKey);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  return ok ? next() : next(new HttpError(401, 'Missing or invalid API key'));
}

/** Parse with a zod schema, converting failures into a 400 with per-field details. */
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new HttpError(
    400,
    'Validation failed',
    r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
  );
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (config.env === 'test') return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

function notFound(_req, _res, next) {
  next(new HttpError(404, 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body too large' } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { message: 'Validation failed' } });
  }
  console.error(err); // never leak internals to the client
  return res.status(500).json({ error: { message: 'Internal server error' } });
}

module.exports = { requireApiKey, parse, requestLogger, notFound, errorHandler };
