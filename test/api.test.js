'use strict';

process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const { todayISO, addDays } = require('../src/utils');

const TODAY = todayISO();

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
  consultationDate: addDays(TODAY, -7), nextFollowUpDate: TODAY, ...o,
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
  assert.equal((await call('POST', '/api/patients', patient({ consultationDate: TODAY, nextFollowUpDate: addDays(TODAY, -1) }))).status, 400);
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
  await call('POST', '/api/patients', patient({ name: 'Later Person', phone: '+919000000002', nextFollowUpDate: addDays(TODAY, 30) }));
  const r = await call('GET', `/api/patients/due-today?date=${TODAY}`);
  assert.deepEqual(r.body.data.map((p) => p.name), ['Asha Verma']);
});

test('marks follow-up completed (idempotent) and removes it from due list', async () => {
  const created = await call('POST', '/api/patients', patient({ name: 'Ravi Kumar', phone: '+919000000003', nextFollowUpDate: addDays(TODAY, 5) }));
  const id = created.body.data.id;
  for (let i = 0; i < 2; i++) {
    const r = await call('PATCH', `/api/patients/${id}/follow-up`, { status: 'completed' });
    assert.equal(r.body.data.followUpStatus, 'completed');
  }
  assert.equal((await call('GET', `/api/patients/due-today?date=${addDays(TODAY, 5)}`)).body.data.length, 0);
  assert.equal((await call('PATCH', `/api/patients/${id}/follow-up`, { status: 'bogus' })).status, 400);
  assert.equal((await call('PATCH', '/api/patients/9999/follow-up', { status: 'completed' })).status, 404);
});

test('unknown route and bad id', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/patients/abc')).status, 400);
});

test('AI workflow: generate -> edit -> approve, never auto-sent', async () => {
  const gen = await call('POST', '/api/followups/generate', { date: TODAY });
  assert.equal(gen.status, 201);
  const draft = gen.body.data[0];
  assert.equal(draft.status, 'pending_review');

  // running again must not duplicate
  const again = await call('POST', '/api/followups/generate', { date: TODAY });
  assert.equal(again.body.meta.created, 0);

  const edited = await call('PATCH', `/api/followups/drafts/${draft.id}`, { message: 'Edited text' });
  assert.equal(edited.body.data.edited, true);

  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/approve`, {})).status, 400); // reviewer required
  const ok = await call('POST', `/api/followups/drafts/${draft.id}/approve`, { reviewer: 'Nurse Priya' });
  assert.equal(ok.body.data.status, 'approved');
  assert.equal(ok.body.sent, false);
  assert.match(ok.body.whatsappLink, /^https:\/\/wa\.me\/919000000001\?text=/);

  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/reject`, { reviewer: 'Nurse Priya' })).status, 409);
  assert.equal((await call('PATCH', `/api/followups/drafts/${draft.id}`, { message: 'late' })).status, 409);
});

const bad = async (over, field) => {
  const r = await call('POST', '/api/patients', patient({ phone: '+919111111111', ...over }));
  assert.equal(r.status, 400, JSON.stringify(over));
  assert.ok(r.body.error.details.some((d) => d.field === field), `${field}: ${JSON.stringify(r.body)}`);
};

test('date rules: no future consultation, no past or far-future follow-up', async () => {
  await bad({ consultationDate: addDays(TODAY, 1), nextFollowUpDate: addDays(TODAY, 2) }, 'consultationDate');
  await bad({ consultationDate: addDays(TODAY, -4000) }, 'consultationDate');
  await bad({ consultationDate: addDays(TODAY, -5), nextFollowUpDate: addDays(TODAY, -1) }, 'nextFollowUpDate');
  await bad({ nextFollowUpDate: addDays(TODAY, 800) }, 'nextFollowUpDate');
  await bad({ consultationDate: '2026-13-01' }, 'consultationDate');
  await bad({ nextFollowUpDate: 20261113 }, 'nextFollowUpDate');
});

test('phone rules: accepts formatted numbers, rejects junk', async () => {
  for (const phone of ['12345', '+0123456789', '+91abcdefghij', '9876543210', '+1234567890123456', '']) {
    await bad({ phone }, 'phone');
  }
  const ok = await call('POST', '/api/patients', patient({ name: 'Priya Sharma', phone: '+1 (415) 555-0132' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.phone, '+14155550132');
});

test('name and notes rules', async () => {
  await bad({ name: '<script>alert(1)</script>' }, 'name');
  await bad({ name: '12345' }, 'name');
  await bad({ name: 'x'.repeat(101) }, 'name');
  await bad({ notes: 'x'.repeat(501) }, 'notes');
  const ok = await call('POST', '/api/patients', patient({ name: "  Zoë   O'Brien-Lee ", phone: '+919222222222', notes: 'line1\nline2\u0000' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.name, "Zoë O'Brien-Lee");
  assert.equal(ok.body.data.notes, 'line1 line2');
});

test('duplicate patient is rejected with 409', async () => {
  const p = patient({ name: 'Dup Person', phone: '+919333333333' });
  assert.equal((await call('POST', '/api/patients', p)).status, 201);
  assert.equal((await call('POST', '/api/patients', { ...p, name: 'dup person' })).status, 409);
});

test('ids and query params are validated', async () => {
  assert.equal((await call('GET', '/api/patients/99999999999999999999')).status, 400);
  assert.equal((await call('GET', '/api/patients?limit=1000')).status, 400);
  assert.equal((await call('GET', '/api/patients?page=0')).status, 400);
  assert.equal((await call('GET', '/api/patients?status=weird')).status, 400);
  assert.equal((await call('GET', '/api/patients/due-today?date=2026-02-30')).status, 400);
  assert.equal((await call('GET', '/api/patients/due-today?includeOverdue=maybe')).status, 400);
  assert.equal((await call('GET', '/api/followups/drafts?status=sent')).status, 400);
  assert.equal((await call('GET', "/api/patients/1%20OR%201=1")).status, 400);
});

test('cannot approve a draft whose patient is already completed', async () => {
  const c = await call('POST', '/api/patients', patient({ name: 'Done Soon', phone: '+919444444444' }));
  const gen = await call('POST', '/api/followups/generate', { patientId: c.body.data.id });
  const draft = gen.body.data[0];
  await call('PATCH', `/api/patients/${c.body.data.id}/follow-up`, { status: 'completed' });
  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/approve`, { reviewer: 'Nurse Priya' })).status, 409);
  assert.equal((await call('POST', `/api/followups/drafts/${draft.id}/reject`, { reviewer: 'Nurse Priya' })).status, 200);
});
