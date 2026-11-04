-- Tareas: el docente asigna una tarea con fecha de entrega a un alumno o a una
-- clase grupal; cada alumno entrega un texto y/o un enlace, conversa con el
-- docente sobre esa entrega y recibe una devolución.
--
--   - homeworks es la consigna, una sola aunque sea para toda una clase.
--   - homework_submissions tiene una fila por alumno asignado, que nace vacía
--     y se completa al entregar. Los destinatarios se fijan al asignar: si
--     dependieran del turno, reprogramar o cancelar una clase le cambiaría o
--     le borraría la tarea (y la entrega) a un alumno.
--   - class_date + start_time identifican la clase grupal de origen, solo
--     para mostrarla; en una tarea para un alumno quedan en NULL.
--   - due_date + due_time van sin zona, en hora argentina, como las clases.
--     is_late se guarda al entregar: la marca no depende de recalcular nada.
--
-- Idempotente. Correr a mano, después de la 019:
--   psql "$DATABASE_URL" -f migrations/020_homework.sql

CREATE TABLE IF NOT EXISTS homeworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  due_time TIME NOT NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  class_date DATE,
  start_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT homeworks_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT homeworks_description_length CHECK (char_length(description) <= 5000),
  CONSTRAINT homeworks_class_complete CHECK ((class_date IS NULL) = (start_time IS NULL))
);

CREATE INDEX IF NOT EXISTS homeworks_teacher_idx ON homeworks (teacher_id, due_date DESC);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text_content TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  is_late BOOLEAN NOT NULL DEFAULT false,
  feedback TEXT NOT NULL DEFAULT '',
  corrected_at TIMESTAMPTZ,

  CONSTRAINT homework_submissions_one_per_student UNIQUE (homework_id, student_id),
  CONSTRAINT homework_submissions_text_length CHECK (char_length(text_content) <= 5000),
  CONSTRAINT homework_submissions_link_length CHECK (char_length(link_url) <= 2000),
  CONSTRAINT homework_submissions_feedback_length CHECK (char_length(feedback) <= 5000),
  -- Entregar es dejar al menos un texto o un enlace.
  CONSTRAINT homework_submissions_has_content CHECK (
    submitted_at IS NULL OR text_content <> '' OR link_url <> ''
  ),
  -- Solo se corrige lo entregado, y corregir es dejar una devolución.
  CONSTRAINT homework_submissions_correction_valid CHECK (
    corrected_at IS NULL OR (submitted_at IS NOT NULL AND feedback <> '')
  )
);

CREATE INDEX IF NOT EXISTS homework_submissions_student_idx
  ON homework_submissions (student_id);

CREATE TABLE IF NOT EXISTS homework_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES homework_submissions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT homework_messages_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS homework_messages_submission_idx
  ON homework_messages (submission_id, created_at);
