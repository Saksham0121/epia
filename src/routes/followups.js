'use strict';

const express = require('express');
const v = require('../validation');
const { parse } = require('../middleware/common');
const { HttpError, asyncHandler, todayISO } = require('../utils');
const ai = require('../services/ai');

/**
 * Human-in-the-loop workflow:
 *   generate -> drafts wait as `pending_review` -> staff edits / approves / rejects.
 * Nothing in this API sends a WhatsApp message. "Approve" only marks the draft ready and
 * returns a click-to-chat link that a staff member opens and sends manually.
 */
module.exports = function followUpRoutes({ patients, drafts, generateDraft = ai.generateFollowUpDraft }) {
  const r = express.Router();

  // Find due (today or overdue) patients and create a draft for each.
  r.post('/generate', asyncHandler(async (req, res) => {
    const { date, patientId } = parse(v.generateBody, req.body || {});
    const day = date || todayISO();
    let targets = patients.listDue(day, { includeOverdue: true });
    if (patientId) targets = targets.filter((p) => p.id === patientId);

    const created = [];
    let skipped = 0;
    for (const p of targets) {
      if (drafts.hasOpenDraft(p.id)) { skipped += 1; continue; } // don't duplicate drafts
      const out = await generateDraft(p);
      created.push(drafts.create({ patientId: p.id, ...out }));
    }
    res.status(created.length ? 201 : 200).json({
      data: created,
      meta: { date: day, dueCount: targets.length, created: created.length, skippedExisting: skipped },
    });
  }));

  r.get('/drafts', (req, res) => {
    const { status } = parse(
      require('zod').z.object({ status: require('zod').z.enum(['pending_review', 'approved', 'rejected']).optional() }),
      req.query,
    );
    res.json({ data: drafts.list({ status }) });
  });

  const load = (id) => {
    const d = drafts.get(id);
    if (!d) throw new HttpError(404, 'Draft not found');
    return d;
  };

  // Staff edits the wording before approving.
  r.patch('/drafts/:id', (req, res) => {
    const id = parse(v.idParam, req.params.id);
    const { message } = parse(v.editDraft, req.body);
    if (load(id).status !== 'pending_review') throw new HttpError(409, 'Draft has already been reviewed');
    res.json({ data: drafts.updateMessage(id, message) });
  });

  const review = (status) => (req, res) => {
    const id = parse(v.idParam, req.params.id);
    const { reviewer } = parse(v.reviewDraft, req.body);
    load(id);
    const { changed, draft } = drafts.review(id, status, reviewer);
    if (!changed) throw new HttpError(409, `Draft has already been ${draft.status}`);
    const body = { data: draft };
    if (status === 'approved') {
      body.sent = false; // explicit: the system never sends automatically
      body.whatsappLink = `https://wa.me/${draft.patientPhone.slice(1)}?text=${encodeURIComponent(draft.message)}`;
    }
    res.json(body);
  };
  r.post('/drafts/:id/approve', review('approved'));
  r.post('/drafts/:id/reject', review('rejected'));

  return r;
};
