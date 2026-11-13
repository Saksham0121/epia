'use strict';

process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');

let server, base;
const fakeAi = async (p) => ({ message: `Hi ${p.name.split(' ')[0]}, follow-up due.`, source: 'mock', model: null });

before(async () => {
  const app = createApp({ db: openDb(':memory:'), generateDraft: fakeAi });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const patient = (o = {}) => ({
  name: 'Asha Verma', phone: '+91 90000-00001',
  consultationDate: '2026-11-01', nextFollowUpDate: '2026-11-13', ...o,
});

test('creates a patient and normalises the phone number', async () => {
  const r = await call('POST', '/api/patients', patient());
  assert.equal(r.status, 201);
  assert.equal(r.body.data.phone, '+919000000001');
  assert.equal(r.body.data.followUpStatus, 'pending');
});

test('rejects invalid input with field details', async () => {
  const r = await call('POST', '/api/patients', { name: 'A', phone: '123', consultationDate: '2026-02-31', nextFollowUpDate: 'x' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.length >= 3);
});

test('rejects follow-up earlier than consultation and unknown fields', async () => {
  assert.equal((await call('POST', '/api/patients', patient({ nextFollowUpDate: '2026-10-01' }))).status, 400);
  assert.equal((await call('POST', '/api/patients', { ...patient(), admin: true })).status, 400);
});

test('rejects malformed JSON', async () => {
  const res = await fetch(base + '/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});

test('lists patients with pagination', async () => {
  const r = await call('GET', '/api/patients?limit=1&page=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.ok(r.body.meta.total >= 1);
});

test('due-today returns only pending patients for that date', async () => {
  await call('POST', '/api/patients', patient({ name: 'Later Person', phone: '+919000000002', nextFollowUpDate: '2026-12-01' }));
  const r = await call('GET', '/api/patients/due-today?date=2026-11-13');
  assert.deepEqual(r.body.data.map((p) => p.name), ['Asha Verma']);
});

test('marks follow-up completed (idempotent) and removes it from due list', async () => {
  const created = await call('POST', '/api/patients', patient({ name: 'Ravi Kumar', phone: '+919000000003', nextFollowUpDate: '2026-11-20' }));
  const id = created.body.data.id;
  for (let i = 0; i < 2; i++) {
    const r = await call('PATCH', `/api/patients/${id}/follow-up`, { status: 'completed' });
    assert.equal(r.body.data.followUpStatus, 'completed');
  }
  assert.equal((await call('GET', '/api/patients/due-today?date=2026-11-20')).body.data.length, 0);
  assert.equal((await call('PATCH', `/api/patients/${id}/follow-up`, { status: 'bogus' })).status, 400);
  assert.equal((await call('PATCH', '/api/patients/9999/follow-up', { status: 'completed' })).status, 404);
});

test('unknown route and bad id', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/patients/abc')).status, 400);
});

test('AI workflow: generate -> edit -> approve, never auto-sent', async () => {
  const gen = await call('POST', '/api/followups/generate', { date: '2026-11-13' });
  assert.equal(gen.status, 201);
  const draft = gen.body.data[0];
  assert.equal(draft.status, 'pending_review');

  // running again must not duplicate
  const again = await call('POST', '/api/followups/generate', { date: '2026-11-13' });
  assert.equal(again.body.meta.created, 0);

  const edited = await call('PATCH', `/api/followups/drafts/${draft.id}`, { message: 'Edited text' });
  assert.equal(edited.body.data.edited, true);

  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/approve`, {})).status, 400); // reviewer required
  const ok = await call('POST', `/api/followups/drafts/${draft.id}/approve`, { reviewer: 'Nurse Priya' });
  assert.equal(ok.body.data.status, 'approved');
  assert.equal(ok.body.sent, false);
  assert.match(ok.body.whatsappLink, /^https:\/\/wa\.me\/919000000001\?text=/);

  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/reject`, { reviewer: 'x' })).status, 409);
  assert.equal((await call('PATCH', `/api/followups/drafts/${draft.id}`, { message: 'late' })).status, 409);
});
