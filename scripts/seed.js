'use strict';

// Seeds FICTIONAL patients, dated relative to today so the "due" demo always has data.
const config = require('../src/config');
const { openDb } = require('../src/db');
const { createPatientRepo } = require('../src/services/patientRepo');
const { todayISO } = require('../src/utils');

const shift = (days) => {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const db = openDb(config.dbPath);
const repo = createPatientRepo(db);

const people = [
  ['Asha Verma', '+919000000001', -7, 0, 'Blood pressure check'],
  ['Rohan Mehta', '+919000000002', -14, 0, 'Post-fever recovery review'],
  ['Meera Nair', '+919000000003', -21, -2, 'Diabetes medication review'],
  ['Karan Singh', '+919000000004', -3, 4, 'Knee pain physiotherapy plan'],
  ['Sana Qureshi', '+919000000005', -10, 7, null],
];
for (const [name, phone, c, f, notes] of people) {
  repo.create({ name, phone, consultationDate: shift(c), nextFollowUpDate: shift(f), notes: notes ?? undefined });
}
console.log(`Seeded ${people.length} fictional patients into ${config.dbPath}`);
db.close();
