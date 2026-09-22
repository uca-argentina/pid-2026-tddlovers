-- Las clases reservadas. La disponibilidad (003) dice cuándo PUEDE dar clase
-- un docente; acá van los turnos que un alumno efectivamente tomó.
--
-- Una clase dura exactamente 1 hora y arranca en :00 o :30 (ver
-- PID-Front/CLAUDE.md). Se guarda la fecha real, no el día de la semana: la
-- plantilla semanal se proyecta sobre fechas y el alumno reserva una de esas.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/004_classes.sql

DO $$ BEGIN
  CREATE TYPE class_status AS ENUM ('reservada', 'cancelada');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  class_date DATE NOT NULL,
  start_time TIME NOT NULL,
  -- Redundante con start_time + 1 h, pero el front lo lee tal cual y así el
  -- CHECK de "dura una hora" se puede escribir en la base.
  end_time TIME NOT NULL,
  status class_status NOT NULL DEFAULT 'reservada',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Las reglas del modelo, en la base y no solo en la UI:
  -- 1) la clase dura exactamente una hora,
  CONSTRAINT classes_one_hour CHECK (end_time - start_time = INTERVAL '1 hour'),
  -- 2) y arranca en punto o y media.
  CONSTRAINT classes_half_hour_aligned CHECK (
    EXTRACT(MINUTE FROM start_time) IN (0, 30) AND EXTRACT(SECOND FROM start_time) = 0
  ),
  -- 3) nadie se reserva a sí mismo.
  CONSTRAINT classes_teacher_is_not_student CHECK (teacher_id <> student_id)
);

-- Dos alumnos pueden apretar "reservar" a la vez: validar en la ruta no
-- alcanza, porque entre el SELECT y el INSERT entra la otra transacción. Lo
-- que de verdad impide la doble reserva es la base.
--
-- Van restricciones de EXCLUSIÓN y no índices únicos sobre start_time: dos
-- clases se pisan sin empezar a la misma hora (14:00-15:00 y 14:30-15:30), y
-- un UNIQUE no lo vería. El rango es [start, end) —abierto a la derecha— así
-- que 14:00-15:00 y 15:00-16:00 conviven, que es justo lo que queremos.
--
-- Parciales (WHERE status = 'reservada') para que una clase cancelada libere
-- el horario en lugar de bloquearlo para siempre.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Postgres trae int4range, daterange, tsrange... pero no un rango de TIME, así
-- que se define acá.
DO $$ BEGIN
  CREATE TYPE timerange AS RANGE (subtype = time);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_teacher_no_overlap;
ALTER TABLE classes ADD CONSTRAINT classes_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    class_date WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'reservada');

-- Un alumno tampoco puede estar en dos clases a la vez, ni con otro docente.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_student_no_overlap;
ALTER TABLE classes ADD CONSTRAINT classes_student_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    class_date WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'reservada');

-- El calendario y el tablero piden siempre un rango de fechas.
CREATE INDEX IF NOT EXISTS classes_teacher_date_idx ON classes (teacher_id, class_date);
CREATE INDEX IF NOT EXISTS classes_student_date_idx ON classes (student_id, class_date);
