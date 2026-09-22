-- Adds profile fields to users, plus a seeded subjects catalog and the
-- teacher <-> subjects join table used by the registration flow.
-- Run manually for now: psql "$DATABASE_URL" -f migrations/002_profile_and_subjects.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nombre TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS apellido TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS telefono TEXT;

ALTER TABLE users ALTER COLUMN nombre DROP DEFAULT;
ALTER TABLE users ALTER COLUMN apellido DROP DEFAULT;

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

INSERT INTO subjects (name) VALUES
  ('Matemática'),
  ('Física'),
  ('Química'),
  ('Biología'),
  ('Programación'),
  ('Inglés'),
  ('Historia'),
  ('Geografía'),
  ('Economía'),
  ('Contabilidad')
ON CONFLICT (name) DO NOTHING;
