'use strict';

const { z } = require('zod');

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
  .min(2, 'must be at least 2 characters')
  .max(100, 'must be at most 100 characters');

const createPatient = z
  .object({
    name,
    phone,
    consultationDate: dateString,
    nextFollowUpDate: dateString,
    notes: z.string().trim().max(500, 'must be at most 500 characters').optional(),
  })
  .strict()
  .refine((p) => p.nextFollowUpDate >= p.consultationDate, {
    path: ['nextFollowUpDate'],
    message: 'must be on or after consultationDate',
  });

const updateFollowUp = z.object({ status: z.literal('completed', {
  errorMap: () => ({ message: "must be 'completed'" }),
}) }).strict();

const idParam = z.coerce.number().int().positive();

const listQuery = z.object({
  status: z.enum(['pending', 'completed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const dueQuery = z.object({
  // Override "today" (handy for testing and demos).
  date: dateString.optional(),
});

const editDraft = z.object({ message: z.string().trim().min(1).max(1000) }).strict();
const reviewDraft = z
  .object({ reviewer: z.string().trim().min(1).max(100) })
  .strict();
const generateBody = z
  .object({ date: dateString.optional(), patientId: z.number().int().positive().optional() })
  .strict();

module.exports = {
  createPatient, updateFollowUp, idParam, listQuery, dueQuery,
  editDraft, reviewDraft, generateBody,
};
