'use strict';

const { z } = require('zod');
const { todayISO, addDays } = require('./utils');

// Business rules for plausible dates.
const MAX_CONSULT_AGE_DAYS = 365 * 10; // consultation no older than ~10 years
const MAX_FOLLOWUP_AHEAD_DAYS = 365 * 2; // follow-up no further than ~2 years out

const dateString = z
  .string({ required_error: 'is required', invalid_type_error: 'must be a string' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'must be a real calendar date');

// Accept "+91 98765-43210" style input; store canonical E.164 ("+919876543210").
const phone = z
  .string({ required_error: 'is required', invalid_type_error: 'must be a string' })
  .transform((s) => s.replace(/[\s().-]/g, ''))
  .refine((s) => /^\+[1-9]\d{7,14}$/.test(s), 'must be an international number like +919876543210');

const name = z
  .string({ required_error: 'is required', invalid_type_error: 'must be a string' })
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'must be at least 2 characters')
      .max(100, 'must be at most 100 characters')
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u, 'may only contain letters, spaces, . \' and -'),
  );

// Control characters have no place in free text; strip them rather than store them.
const notes = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(500, 'must be at most 500 characters'));

const createPatient = z
  .object({
    name,
    phone,
    consultationDate: dateString,
    nextFollowUpDate: dateString,
    notes: notes.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const today = todayISO();
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (p.consultationDate > today) issue('consultationDate', 'cannot be in the future');
    if (p.consultationDate < addDays(today, -MAX_CONSULT_AGE_DAYS)) issue('consultationDate', 'is too far in the past');
    if (p.nextFollowUpDate < p.consultationDate) issue('nextFollowUpDate', 'must be on or after consultationDate');
    if (p.nextFollowUpDate < today) issue('nextFollowUpDate', 'cannot be in the past (use today or later)');
    if (p.nextFollowUpDate > addDays(today, MAX_FOLLOWUP_AHEAD_DAYS)) issue('nextFollowUpDate', 'is more than 2 years away');
  });

const updateFollowUp = z.object({ status: z.literal('completed', {
  errorMap: () => ({ message: "must be 'completed'" }),
}) }).strict();

const idParam = z.coerce.number().int().positive().safe();

const listQuery = z.object({
  status: z.enum(['pending', 'completed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const dueQuery = z.object({
  includeOverdue: z.enum(['true', 'false']).optional(),
  // Override "today" (handy for testing and demos).
  date: dateString.optional(),
});

const draftListQuery = z.object({
  status: z.enum(['pending_review', 'approved', 'rejected']).optional(),
});

const editDraft = z.object({ message: z.string().trim().min(1).max(1000)
  .refine((m) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(m), 'contains control characters') }).strict();
const reviewDraft = z
  .object({ reviewer: name })
  .strict();
const generateBody = z
  .object({ date: dateString.optional(), patientId: z.number().int().positive().safe().optional() })
  .strict();

module.exports = {
  createPatient, updateFollowUp, idParam, listQuery, dueQuery,
  editDraft, reviewDraft, generateBody, draftListQuery,
};
