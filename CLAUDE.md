# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context
- University group web app project: React frontend + Fastify backend + Postgres, fully Dockerized.
- Team works across Apple Silicon Macs (M1/M2) and at least one Windows desktop — keep cross-platform tooling in mind (line endings, shell scripts, etc.). `.gitattributes` normalizes line endings — don't remove it.
- **The app is in Spanish.** The team and its users are Argentinian, so everything user-facing is rioplatense Spanish (voseo: "Elegí", "tenés") — UI copy, validation messages, API error `message` strings, `aria-label`s/placeholders, dates and money (`Intl` with `es-AR`), and any text a proxy/error page serves. There is no i18n layer anywhere and none is planned — write the Spanish string directly. The API `error` code and `fields` keys stay English/ASCII (read by the frontend, not shown to the user). Comments in code are in Spanish too, and explain **why**, not what.

## App concept
A responsive web app (must work well on phone) that connects students and teachers.
- **Single account type**: role is chosen at signup, not separate signup flows. On the wire, in the DB, and in frontend logic the role is **`"teacher"` or `"student"`** — English. The `user_role` enum stores this; "Docente"/"Alumno" are display text only, produced at render time. Never compare against/accept `docente`/`alumno`.
- **Teachers**: pick which subjects they teach from a fixed list (profile) and, in the same profile, set an **hourly rate per subject × modality** (`teacher_rates`, in **cents**, e.g. Matemática virtual $ 5.000/h; empty = doesn't teach it that way; 0 = free). Then they load **availability windows** from the Disponibilidad screen (a read-only week calendar + a per-day modal of cards). Each window has only: a date, optionally **repeats weekly** from that date on (so every week can differ), start/end (`:00`/`:30`, ≥30 min long), **modality** (`virtual` | `in_person` | `hybrid` — English on the wire, "Virtual/Presencial/Híbrida" on screen; virtual needs `meetingUrl`; in-person needs `locality` — the general area, e.g. "Palermo, CABA", shown to every student — **and** `address`, the exact one, shown only to students who booked; hybrid needs all three) and **capacity** `maxStudents` (1 = individual, 2–50 = group). A window can't be saved in a modality the teacher has no rate for. Windows carry **no subject, duration or price**.
- **Students**: browse offered windows (one card per window per date, showing the subjects bookable there and "desde $X/h"), filter by day/subject/modality/individual-vs-group/time, and book.
- **Booking**: the student picks the **subject** (among those the teacher has a rate for in the window's modality), a **start** (`:00`/`:30`) and a **duration** (≥30 min, steps of 5, must fit before the window's end and not overlap another class of that teacher). Price = `round(hourlyRateCents × minutes / 60)`, computed by the backend (`lib/teacherRates.js`; the frontend mirrors it in `utils/rates.js` for display only). In a **group** window, other students can join an already-started class only with the **same start, subject and duration**, until it's full. Modality/link/locality/address/`price_cents` are **copied onto the class** at booking time, so later edits to the window or rates don't move booked classes. Neither the meeting link nor the exact address is ever exposed by `/api/availability` (it carries `locality` only); students see them once booked.
- **Payments**: out of scope for this version (prices are shown and stored, not charged).

### The one design decision to understand across front and back: windows → dated availability
A teacher saves windows via `POST/PUT/DELETE /api/teachers/me/availability[/:id]`; `GET /api/teachers/me/availability?from&to` returns the raw windows that fall in the range (the teacher screen places them with `utils/windows.js` `occursOn`). A student books a **date**. `GET /api/availability` returns one row per **(window, date)**, already net of what's booked, via `backend/src/lib/availabilityExpansion.js`: `subjects: [{ id, name, hourlyRateCents }]` (the teacher's rates in that modality), `free: [{ start, end }]` (stretches with no class of that teacher; `start` is the first `:00`/`:30`, `end` any minute) and `groups: [{ start, end, subjectId, subjectName, enrolled }]` (joinable group classes). There's no closed list of slots because the student picks the duration; the frontend derives start options and max durations (`utils/booking.js` `startOptions`) and the backend re-validates on `POST /api/classes`. Windows whose modality has no rate aren't offered. Two different meanings of "booked", only one subtracted:
- Booked **with that teacher** → subtracted (except remaining seats in a group class, offered in `groups`).
- Booked by **this student with someone else** → not subtracted; the frontend greys those starts out using `/api/classes?student=me` (`annotateClashes`).

Rules the backend must enforce (the UI already does, but the UI can be bypassed): window start/end and class **starts** on `:00`/`:30` (class **ends** land wherever the duration puts them, in steps of 5 min, e.g. 13:45); class duration ≥30 min and within the window; rates in whole cents and only for subjects in the profile (`teacher_rates` FKs `teacher_subjects`, so dropping a subject drops its rates); a teacher's windows can't overlap on any date (weekly vs one-off included — checked in `db/availability.js` under an advisory lock, not a DB constraint); a window's modality must have at least one rate; a teacher never gives two classes at once (exclusion constraint allows only same-start group rows); joining a group requires same subject and duration, plus capacity (checked in `bookClass` under a per-teacher+date lock); a student can't have overlapping classes even by a minute; the booked subject must have a rate in the window's modality.

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
- **Dates** are `"YYYY-MM-DD"` local time, no timezone/`Z`. "Now" on the backend is Argentina time via `backend/src/lib/clock.js` — the container runs in UTC, so never use `new Date()` getters or `toISOString()` for today. **Times** are `"HH:MM"` 24h; starts are always `:00`/`:30`, a class end can be any minute. A range's `end` is exclusive; midnight is written `"24:00"`, never `"00:00"`. Weekday keys are ASCII lowercase without accents (`lunes` … `domingo`), week starts Monday — these are JSON/DB values, not display text.
- Check `pwd` before `npm install` — `package-lock.json` has repeatedly ended up committed to the wrong subfolder.
