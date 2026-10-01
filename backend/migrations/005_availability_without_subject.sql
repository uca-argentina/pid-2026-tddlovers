-- Cambio de requerimiento: el docente ya no ofrece horarios POR MATERIA.
-- Marca una sola semana ("los lunes de 13:00 a 15:30") y es el alumno el que,
-- al reservar, elige para qué materia es la clase (entre las que da ese
-- docente). La materia sigue viviendo en `classes`; sale de `availability`.
--
-- Los datos viejos se descartan a propósito (decisión del equipo): eran de
-- prueba, y unir las semanas de varias materias no aportaba nada. Cada
-- docente vuelve a cargar su disponibilidad.
--
-- Idempotente: se puede correr más de una vez sin romper nada — el DELETE
-- solo borra mientras la columna vieja todavía existe.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/005_availability_without_subject.sql

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'availability' AND column_name = 'subject_id'
  ) THEN
    DELETE FROM availability;
  END IF;
END $$;

DROP INDEX IF EXISTS availability_teacher_subject_idx;
ALTER TABLE availability DROP COLUMN IF EXISTS subject_id;

-- Antes lo impedía la pantalla (los horarios de las otras materias salían
-- bloqueados); ahora es una sola semana y tampoco puede tener ventanas que se
-- pisen. La ruta ya lo valida; esto es la última red. [) para que 13:00-14:00
-- y 14:00-15:00 convivan.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_no_overlap;
ALTER TABLE availability ADD CONSTRAINT availability_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_key WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  );
