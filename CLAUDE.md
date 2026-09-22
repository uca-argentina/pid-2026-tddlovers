# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context
- University group web app project: React frontend + Fastify backend + Postgres, fully Dockerized.
- Team works across Apple Silicon Macs (M1/M2) and at least one Windows desktop — keep cross-platform tooling in mind (line endings, shell scripts, etc.). `.gitattributes` normalizes line endings — don't remove it.
- **The app is in Spanish.** The team and its users are Argentinian, so everything user-facing is rioplatense Spanish (voseo: "Elegí", "tenés") — UI copy, validation messages, API error `message` strings, `aria-label`s/placeholders, dates (`Intl` with `es-AR`), and any text a proxy/error page serves. There is no i18n layer anywhere and none is planned — write the Spanish string directly. The API `error` code and `fields` keys stay English/ASCII (read by the frontend, not shown to the user). Comments in code are in Spanish too, and explain **why**, not what.

## App concept
A responsive web app (must work well on phone) that connects students and teachers.
- **Single account type**: role is chosen at signup, not separate signup flows. On the wire, in the DB, and in frontend logic the role is **`"teacher"` or `"student"`** — English. The `user_role` enum stores this; "Docente"/"Alumno" are display text only, produced at render time. Never compare against/accept `docente`/`alumno`.
- **Teachers**: pick which subjects they teach from a fixed list, and set their availability as **one weekly template** (e.g. "Mondays 13:00–15:30") — **not per subject**, and not specific dates. The backend expands this into dated availability (see below). Classes are always **1 hour long**, starting only on `:00` or `:30`.
- **Students**: search/browse teachers, view their profile and subjects, see availability and open class slots.
- **Booking**: a student picking a slot **reserves it** — it disappears from availability for other students once booked. The **student chooses the subject when booking**, from the subjects that teacher teaches (`teacher_subjects`); `classes.subject_id` is where the subject lives, `availability` has none.
- **Payments/pricing**: out of scope for this version.

### The one design decision to understand across front and back: weekly template → dated availability
A teacher saves a **weekly template** (`{ lunes: [13:00–15:30] }`, via `PUT /api/teachers/me/availability`). A student books a **date** (`2026-09-14`). The backend bridges the two: `GET /api/availability` returns one row per **(teacher, date)** — with the teacher's `subjects: [{ id, name }]` to pick from — that already has a `date` and is already net of what's booked, via `backend/src/lib/availabilityExpansion.js` (ported from the frontend's original `src/utils/booking.js`). Teachers with no subjects aren't listed. Two different meanings of "booked", only one subtracted:
- Booked **with that teacher** → subtract it (matching by teacher+date, whatever the subject). A row left with no ranges is dropped.
- Booked by **this student with someone else** → don't subtract; the frontend greys it out using `/api/classes?student=me`.

Rules the backend must enforce (the UI already does, but the UI can be bypassed): a class is exactly 1h starting at `:00`/`:30`; a booked hour disappears from that teacher's availability for everybody; a teacher can't double-book; a student can't have overlapping classes even by a minute; an availability block under 1h is invalid, and blocks of the same day can't overlap; the booked subject must be one the teacher teaches.

## Local dev ports
- Frontend: `127.0.0.1:5173`
- Backend: `127.0.0.1:4000`
- Postgres: `127.0.0.1:5432` (not exposed publicly in production — only reachable from the backend container)

Use `127.0.0.1`, not `localhost`: on macOS `localhost` resolves to `::1` first, and if any other project's dev server is bound to `[::1]:5173` it silently wins over Docker's wildcard bind. Check with `lsof -nP -iTCP:5173 -sTCP:LISTEN`.

## Commands
Run these from inside the respective subfolder (`PID-Front/` or `PID-Back/`), not from the repo root — there's no root-level `package.json`.

**Frontend**
- `npm run dev` — Vite dev server (not `npm start`, that's a CRA habit).
- `npm test` — vitest + jsdom + Testing Library. Tests are colocated (`Thing.jsx` → `Thing.test.jsx`).
- `npm run lint` — must pass before pushing, along with `npm test`.

**Backend**
- Tests: vitest, colocated (`index.js` → `<area>.test.js`), using `buildApp()` + `app.inject()` (no real port). See `src/app.test.js` for the pattern.
- Migrations: plain `.sql` in `migrations/`, applied by hand in filename order, no runner — `psql "$DATABASE_URL" -f migrations/00N_*.sql`. Write them idempotently (`IF NOT EXISTS`), nothing prevents re-running one.

**Infra / Docker**
- Dev stack: `docker compose -f docker-compose.dev.yml up --build`.
- After changing dependencies in either app, rebuild with `-V` (not just `--build`): `docker compose -f docker-compose.dev.yml up --build -V`. Both app services mount an anonymous `/app/node_modules` volume that Docker seeds only once and then persists across rebuilds, shadowing a freshly built image's deps — symptom is `Failed to resolve import "<package>"` in the browser/server despite a clean build. **Never use `down -v`** — that also wipes the named `pgdata_dev` volume and deletes the database.

## Cross-cutting conventions
- **Style differs on purpose between the two app repos** — match whichever folder you're editing, don't impose one on the other, and don't run a formatter (neither has a prettier config):
  - `PID-Back/`: semicolons, single quotes, 2-space indent, ~100 cols.
  - `PID-Front/`: no semicolons, single quotes, 2-space indent, ~100 cols. Class components only — hooks are banned except in the one bridge file `src/routes/withRouter.jsx`.
- **IDs are opaque UUID strings** (`gen_random_uuid()`), never numbers — don't coerce with `Number()`, compare with `String(a) === String(b)`.
- **Dates** are `"YYYY-MM-DD"` local time, no timezone/`Z`. **Times** are `"HH:MM"` 24h, always `:00`/`:30`. A range's `end` is exclusive; midnight is written `"24:00"`, never `"00:00"`. Weekday keys are ASCII lowercase without accents (`lunes` … `domingo`), week starts Monday — these are JSON/DB values, not display text.
- Check `pwd` before `npm install` — `package-lock.json` has repeatedly ended up committed to the wrong subfolder.
