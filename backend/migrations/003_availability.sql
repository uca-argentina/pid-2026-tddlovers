-- Disponibilidad semanal del docente: la plantilla que después se proyecta
-- sobre fechas concretas cuando el alumno busca turnos.
--
-- El modelo (acordado por el equipo, ver PID-Front/CLAUDE.md):
--   el docente marca ventanas por día de la semana ("los lunes de 13:00 a
--   15:30") para UNA materia, y el alumno reserva adentro de esa ventana un
--   turno de exactamente 1 hora que empieza en :00 o :30.
--
-- La plantilla NO tiene vigencia: vale para todas las semanas hasta que el
-- docente la cambie. Por eso se guarda el día de la semana y no una fecha.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/003_availability.sql

-- Los días son ASCII, en minúscula y sin acentos: son claves de JSON y
-- valores de la base, no texto de pantalla. La semana arranca el lunes.
DO $$ BEGIN
  CREATE TYPE week_day AS ENUM (
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  day_key week_day NOT NULL,
  -- `end_time` es EXCLUSIVO. Una ventana que termina a medianoche se guarda
  -- como '24:00', nunca '00:00': con '00:00' se rompe start < end y con él
  -- todo lo que ordena o valida.
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,

  -- Las tres reglas del modelo, en la base y no solo en la UI:
  -- 1) el rango va para adelante,
  CONSTRAINT availability_start_before_end CHECK (start_time < end_time),
  -- 2) todo cae en :00 o :30 — un turno no puede empezar a las 13:07,
  CONSTRAINT availability_half_hour_aligned CHECK (
    EXTRACT(MINUTE FROM start_time) IN (0, 30)
    AND EXTRACT(SECOND FROM start_time) = 0
    AND EXTRACT(MINUTE FROM end_time) IN (0, 30)
    AND EXTRACT(SECOND FROM end_time) = 0
  ),
  -- 3) una ventana de menos de 1 h no sirve: no entra una clase.
  CONSTRAINT availability_fits_one_class CHECK (end_time - start_time >= INTERVAL '1 hour')
);

-- La consulta de siempre es "toda la disponibilidad de este docente", que es
-- lo que pide la pantalla del scheduler (necesita las OTRAS materias para
-- pintar los horarios bloqueados).
CREATE INDEX IF NOT EXISTS availability_teacher_idx ON availability(teacher_id);
CREATE INDEX IF NOT EXISTS availability_teacher_subject_idx
  ON availability(teacher_id, subject_id);
