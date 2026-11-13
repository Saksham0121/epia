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
const MAX_PER_GENERATE = 25;

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
    // Cap work per request: each draft is a paid AI call. Call again for the remainder.
    const batch = targets.filter((p) => !drafts.hasOpenDraft(p.id));
    skipped = targets.length - batch.length;
    for (const p of batch.slice(0, MAX_PER_GENERATE)) {
      const out = await generateDraft(p);
      try {
        created.push(drafts.create({ patientId: p.id, ...out }));
      } catch (err) {
        // A concurrent request created the open draft first (unique index): skip, don't fail.
        if (!/UNIQUE/i.test(err.message)) throw err;
        skipped += 1;
      }
    }
    const remaining = Math.max(0, batch.length - MAX_PER_GENERATE);
    res.status(created.length ? 201 : 200).json({
      data: created,
      meta: { date: day, dueCount: targets.length, created: created.length, skippedExisting: skipped, remaining },
    });
  }));

  r.get('/drafts', (req, res) => {
    const { status } = parse(v.draftListQuery, req.query);
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
    const existing = load(id);
    if (status === 'approved' && patients.get(existing.patientId)?.followUpStatus === 'completed') {
      throw new HttpError(409, 'Follow-up is already completed; reject this draft instead');
    }
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
