'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateFollowUpDraft, buildPrompt } = require('../src/services/ai');

const p = { name: 'Asha Verma', phone: '+919000000001', consultationDate: '2026-11-01', nextFollowUpDate: '2026-11-13', notes: 'Blood pressure check' };

test('falls back to a labelled mock draft when no API key is set', async () => {
  const d = await generateFollowUpDraft(p, { clinicName: 'Test Clinic' });
  assert.equal(d.source, 'mock');
  assert.match(d.message, /Asha/);
  assert.match(d.message, /Test Clinic/);
});

test('prompt never contains phone number or surname', () => {
  const prompt = buildPrompt(p, 'Test Clinic');
  assert.ok(!prompt.includes('9000000001'));
  assert.ok(!prompt.includes('Verma'));
});
