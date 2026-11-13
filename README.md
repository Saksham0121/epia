# Patient Follow-up System

A small, production-minded backend for tracking patient follow-ups, plus an **AI-assisted WhatsApp reminder workflow** where every message is drafted by a model and **must be reviewed and approved by a staff member**. Nothing is ever sent automatically.

> All data is fictional. Do not store real patient information in a demo deployment.

- **Stack:** Node.js 22.13+, Express, SQLite (Node's built-in `node:sqlite`, zero native dependencies), Zod validation, Helmet, rate limiting
- **AI:** Google Gemini API, with an automatic, clearly-labelled **mock fallback** when no key is configured
- **UI:** a tiny dashboard served at `/` that exercises every endpoint and shows live request/response logs

## Quick start

```bash
npm install
npm run seed      # optional: loads 5 fictional patients, dated relative to today
npm start         # http://localhost:3000
npm test          # 11 tests, in-memory DB, no network
```

Open <http://localhost:3000> for the dashboard. Copy `.env.example` to `.env`-style environment variables as needed (see [Configuration](#configuration)).

## API

Base path `/api`. JSON in, JSON out. Errors always look like `{"error":{"message":"...","details":[{"field","message"}]}}`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/patients` | Add a patient |
| `GET` | `/api/patients?status=&page=&limit=` | List all patients (paginated, optional status filter) |
| `GET` | `/api/patients/due-today?date=&includeOverdue=` | Pending follow-ups due today (`date` overrides today; `includeOverdue=true` adds past-due) |
| `GET` | `/api/patients/:id` | Get one patient |
| `PATCH` | `/api/patients/:id/follow-up` | Mark follow-up completed (`{"status":"completed"}`), idempotent |
| `POST` | `/api/followups/generate` | Draft messages for all due/overdue patients (no duplicates) |
| `GET` | `/api/followups/drafts?status=` | List drafts (`pending_review`, `approved`, `rejected`) |
| `PATCH` | `/api/followups/drafts/:id` | Staff edits the wording (only while pending) |
| `POST` | `/api/followups/drafts/:id/approve` | Approve (`{"reviewer":"name"}`), returns a manual click-to-chat link |
| `POST` | `/api/followups/drafts/:id/reject` | Reject (`{"reviewer":"name"}`) |
| `GET` | `/health` | Liveness probe |

### Patient fields

| Field | Rules |
|---|---|
| `name` | 2-100 chars; letters, spaces, `.` `'` `-` only (unicode names OK); whitespace collapsed |
| `phone` | International format with country code, 8-15 digits, e.g. `+919000000001`. Spaces, dashes and brackets are accepted and stripped; stored as E.164 |
| `consultationDate` | Real `YYYY-MM-DD` date; **not in the future**, not older than ~10 years (clinic timezone) |
| `nextFollowUpDate` | Real date; **today or later**, on/after the consultation date, at most ~2 years ahead |
| `notes` | Optional, max 500 chars; control characters stripped; used to personalise the draft |

A patient with the same name (case-insensitive), phone and follow-up date as an existing one is rejected with `409`.

Unknown fields are rejected. Status codes: `201` created, `400` validation, `401` bad API key, `404` not found, `409` draft already reviewed, `429` rate limited.

### Example session

```bash
curl -X POST localhost:3000/api/patients -H 'content-type: application/json' -d '{
  "name":"Asha Verma","phone":"+91 90000 00001",
  "consultationDate":"2026-11-01","nextFollowUpDate":"2026-11-13","notes":"Blood pressure check"}'

curl localhost:3000/api/patients
curl localhost:3000/api/patients/due-today
curl -X PATCH localhost:3000/api/patients/1/follow-up -H 'content-type: application/json' -d '{"status":"completed"}'

# AI workflow
curl -X POST localhost:3000/api/followups/generate -H 'content-type: application/json' -d '{}'
curl localhost:3000/api/followups/drafts?status=pending_review
curl -X POST localhost:3000/api/followups/drafts/1/approve -H 'content-type: application/json' -d '{"reviewer":"Nurse Priya"}'
```

If `API_KEY` is set, add `-H 'x-api-key: <key>'` to every `/api` call.

## The AI workflow (Task 2)

1. `POST /api/followups/generate` finds patients whose follow-up is **due today or overdue** and still `pending`.
2. For each, a personalised WhatsApp draft is generated and stored as `pending_review`. Re-running never duplicates an open draft.
3. Staff open the dashboard, read the draft, optionally edit it, then **Approve** or **Reject** (reviewer name is recorded with a timestamp).
4. Approval returns `"sent": false` and a `wa.me` link; a human opens it and presses send themselves. There is no sending code anywhere.

**Privacy & safety by design:** the prompt contains only the patient's *first name*, dates and short notes. The phone number and surname are never sent to the model (covered by a test). Patient notes are fenced as untrusted data in the prompt, and the model is told not to give medical advice.

**Mock fallback / limitation:** without `GEMINI_API_KEY` (or if the API errors or times out), drafts come from a deterministic template and are labelled `MOCK` in the API (`source: "mock"`) and UI. The workflow, review gate and approval behave identically; only the wording is less natural.

## Security

- Draft approval is blocked (`409`) once the patient's follow-up is completed, and the database enforces one open draft per patient even under concurrent requests
- `/api/followups/generate` has its own tight rate limit (10/min) and processes at most 25 patients per call, since each is a paid AI call
- Patient text is stripped of `<` `>` before entering the AI prompt so it can't break out of the data fence (prompt-injection hardening)
- Input validated with Zod (types, formats, lengths, strict objects); all SQL is parameterised
- `helmet` headers incl. a strict CSP (the UI uses no inline scripts, renders via `textContent`)
- Optional API-key auth with constant-time comparison; per-IP rate limiting; 10 KB body limit
- Internal errors are logged server-side and never leaked; CORS closed unless `CORS_ORIGIN` is set
- Runs as non-root in Docker; graceful shutdown on SIGTERM

## Scalability notes

- Stateless app; all state in the DB, so instances can be scaled horizontally once the DB is shared
- Composite index `(follow_up_status, next_follow_up_date)` keeps due-queries fast; list endpoints are paginated
- SQLite runs in WAL mode (fast concurrent reads). Data access is isolated in `src/services/*Repo.js`, so moving to PostgreSQL means swapping those two files
- Next steps for real scale: Postgres, a job queue for bulk AI generation, a scheduled daily generation job, and a real WhatsApp Business API adapter behind the same approval gate

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DB_PATH` | `./data/patients.db` | |
| `CLINIC_NAME` | `Sunrise Family Clinic` | Used in drafts |
| `CLINIC_TIMEZONE` | `Asia/Kolkata` | Defines what "today" means |
| `API_KEY` | _(unset)_ | Set to require `x-api-key` on `/api` |
| `GEMINI_API_KEY` | _(unset)_ | Unset = mock drafts |
| `AI_MODEL` | `gemini-2.5-flash` | |
| `RATE_LIMIT_PER_MIN` | `120` | Per IP |
| `CORS_ORIGIN` | _(same-origin)_ | Comma-separated allowed origins |

## Deploy

**Docker:** `docker build -t followup . && docker run -p 3000:3000 -e API_KEY=secret -v followup-data:/data followup`

**Render:** push this repo to GitHub, then *New > Blueprint* and select it; `render.yaml` provisions the service with a generated `API_KEY`. The free tier's disk is ephemeral, which is fine for a demo (use the dashboard's API key box to authenticate).

## Project layout

```
src/app.js            app factory (middleware, routes)      src/routes/       HTTP layer
src/db.js             schema + migrations                   src/services/     repos + AI client
src/validation.js     Zod schemas                           public/           dashboard UI
test/                 node:test suites                      scripts/seed.js   fictional data
```

See [AI_USAGE_NOTE.md](AI_USAGE_NOTE.md) for the AI-tools note.
