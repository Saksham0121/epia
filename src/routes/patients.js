'use strict';

const express = require('express');
const v = require('../validation');
const { parse } = require('../middleware/common');
const { HttpError, todayISO } = require('../utils');

module.exports = function patientRoutes({ patients }) {
  const r = express.Router();

  // Create a patient
  r.post('/', (req, res) => {
    const body = parse(v.createPatient, req.body);
    if (patients.findDuplicate(body)) {
      throw new HttpError(409, 'A patient with the same name, phone and follow-up date already exists');
    }
    const patient = patients.create(body);
    res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
  });

  // List all patients (paginated, optional ?status=pending|completed)
  r.get('/', (req, res) => {
    const q = parse(v.listQuery, req.query);
    const { total, rows } = patients.list(q);
    res.json({
      data: rows,
      meta: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
    });
  });

  // Pending follow-ups due today. Declared before "/:id" so it isn't captured as an id.
  r.get('/due-today', (req, res) => {
    const { date, includeOverdue } = parse(v.dueQuery, req.query);
    const day = date || todayISO();
    const due = patients.listDue(day, { includeOverdue: includeOverdue === 'true' });
    res.json({ data: due, meta: { date: day, count: due.length } });
  });

  r.get('/:id', (req, res) => {
    const patient = patients.get(parse(v.idParam, req.params.id));
    if (!patient) throw new HttpError(404, 'Patient not found');
    res.json({ data: patient });
  });

  // Mark follow-up as completed. Idempotent: repeating the call is safe.
  r.patch('/:id/follow-up', (req, res) => {
    const id = parse(v.idParam, req.params.id);
    parse(v.updateFollowUp, req.body);
    if (!patients.get(id)) throw new HttpError(404, 'Patient not found');
    res.json({ data: patients.complete(id) });
  });

  return r;
};
