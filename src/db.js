'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node >= 22.13, no native build step

/**
 * Opens (and migrates) the SQLite database.
 * WAL mode gives concurrent readers while a write is in progress.
 * Pass ':memory:' for tests.
 */
function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL,
      phone               TEXT NOT NULL,
      consultation_date   TEXT NOT NULL,            -- YYYY-MM-DD
      next_follow_up_date TEXT NOT NULL,            -- YYYY-MM-DD
      follow_up_status    TEXT NOT NULL DEFAULT 'pending'
                          CHECK (follow_up_status IN ('pending','completed')),
      notes               TEXT,                     -- optional, used to personalise the draft
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Serves the "due" queries without a full table scan.
    CREATE INDEX IF NOT EXISTS idx_patients_due
      ON patients (follow_up_status, next_follow_up_date);

    CREATE TABLE IF NOT EXISTS drafts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      message     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review','approved','rejected')),
      source      TEXT NOT NULL CHECK (source IN ('ai','mock')),
      model       TEXT,
      edited      INTEGER NOT NULL DEFAULT 0,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts (status);
    CREATE INDEX IF NOT EXISTS idx_drafts_patient ON drafts (patient_id, status);
    -- Database-level guarantee: at most one open draft per patient, even under concurrent requests.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_draft
      ON drafts (patient_id) WHERE status = 'pending_review';
  `);
  return db;
}

module.exports = { openDb };
