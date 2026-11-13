'use strict';

const toDraft = (r) =>
  r && {
    id: r.id,
    patientId: r.patient_id,
    message: r.message,
    status: r.status,
    source: r.source,
    model: r.model,
    edited: !!r.edited,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    ...(r.patient_name !== undefined && { patientName: r.patient_name, patientPhone: r.patient_phone }),
  };

const JOINED = `SELECT d.*, p.name AS patient_name, p.phone AS patient_phone
                FROM drafts d JOIN patients p ON p.id = d.patient_id`;

function createDraftRepo(db) {
  const insert = db.prepare(
    `INSERT INTO drafts (patient_id, message, source, model) VALUES (@patientId, @message, @source, @model)`,
  );
  const byId = db.prepare(`${JOINED} WHERE d.id = ?`);
  const open = db.prepare(
    `SELECT id FROM drafts WHERE patient_id = ? AND status = 'pending_review' LIMIT 1`,
  );

  return {
    create: (d) => toDraft(byId.get(insert.run(d).lastInsertRowid)),
    get: (id) => toDraft(byId.get(id)),
    hasOpenDraft: (patientId) => !!open.get(patientId),
    list({ status }) {
      const rows = status
        ? db.prepare(`${JOINED} WHERE d.status = ? ORDER BY d.id DESC`).all(status)
        : db.prepare(`${JOINED} ORDER BY d.id DESC`).all();
      return rows.map(toDraft);
    },
    updateMessage(id, message) {
      db.prepare(`UPDATE drafts SET message = ?, edited = 1 WHERE id = ? AND status = 'pending_review'`).run(message, id);
      return toDraft(byId.get(id));
    },
    /** Only a pending draft can be reviewed; returns undefined-change if already decided. */
    review(id, status, reviewer) {
      const info = db
        .prepare(`UPDATE drafts SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
                  WHERE id = ? AND status = 'pending_review'`)
        .run(status, reviewer, id);
      return { changed: info.changes === 1, draft: toDraft(byId.get(id)) };
    },
  };
}

module.exports = { createDraftRepo };
