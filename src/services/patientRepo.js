'use strict';

/** Data-access layer. All SQL is parameterised; swap this module to move to Postgres. */

const toPatient = (r) =>
  r && {
    id: r.id,
    name: r.name,
    phone: r.phone,
    consultationDate: r.consultation_date,
    nextFollowUpDate: r.next_follow_up_date,
    followUpStatus: r.follow_up_status,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

function createPatientRepo(db) {
  const insert = db.prepare(`
    INSERT INTO patients (name, phone, consultation_date, next_follow_up_date, notes)
    VALUES (@name, @phone, @consultationDate, @nextFollowUpDate, @notes)`);
  const byId = db.prepare('SELECT * FROM patients WHERE id = ?');
  const markCompleted = db.prepare(`
    UPDATE patients SET follow_up_status = 'completed', updated_at = datetime('now') WHERE id = ?`);

  return {
    create(p) {
      const info = insert.run({ ...p, notes: p.notes ?? null });
      return toPatient(byId.get(info.lastInsertRowid));
    },
    get: (id) => toPatient(byId.get(id)),
    list({ status, page, limit }) {
      const where = status ? 'WHERE follow_up_status = @status' : '';
      const total = db.prepare(`SELECT COUNT(*) c FROM patients ${where}`).get({ status }).c;
      const rows = db
        .prepare(`SELECT * FROM patients ${where} ORDER BY next_follow_up_date, id LIMIT @limit OFFSET @offset`)
        .all({ status, limit, offset: (page - 1) * limit });
      return { total, rows: rows.map(toPatient) };
    },
    /** Pending follow-ups for exactly `date`, or on/before it when includeOverdue is set. */
    listDue(date, { includeOverdue = false } = {}) {
      const op = includeOverdue ? '<=' : '=';
      return db
        .prepare(`SELECT * FROM patients WHERE follow_up_status = 'pending'
                  AND next_follow_up_date ${op} ? ORDER BY next_follow_up_date, id`)
        .all(date)
        .map(toPatient);
    },
    complete(id) {
      markCompleted.run(id);
      return toPatient(byId.get(id));
    },
  };
}

module.exports = { createPatientRepo };
