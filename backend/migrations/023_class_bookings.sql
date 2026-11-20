-- Divide `classes` en dos tablas:
--
--   - classes: la CLASE (un turno). Docente, materia, fecha, horario y lo que
--     se copió de la ventana al reservar (modalidad, cupo, link, dirección,
--     localidad). Una grupal con 5 alumnos es UNA fila.
--   - class_bookings: lo de CADA ALUMNO en esa clase. Estado, pago (precio,
--     paid_at, paquete o canje de neuronas), cancelación y reprogramación.
--
-- Antes había una fila por alumno y los datos de la clase se repetían en cada
-- una; que coincidieran dependía del código (y ya falló una vez: el cupo se
-- medía contra una ventana editada).
--
-- Decisiones:
--   - class_bookings ES la tabla vieja renombrada: cada reserva conserva su id,
--     así no cambian /api/classes/:id, ?reprogramar=<id>, rescheduled_from ni
--     las claves 'class:<id>' de neurona_credits.
--   - class_bookings guarda una COPIA de fecha y horario de su clase, atada con
--     una FK compuesta (class_id, class_date, start_time, end_time) con ON
--     UPDATE CASCADE: no se puede desincronizar, y permite mantener en la base
--     la regla de que un alumno no tenga dos clases superpuestas
--     (class_bookings_student_no_overlap), que no se puede escribir entre dos
--     tablas.
--   - classes.active = la clase tiene alguna reserva no cancelada. Lo mantiene
--     el trigger class_bookings_sync_active (cancelar la última la apaga), y
--     classes_teacher_no_overlap solo mira las activas: una clase cancelada
--     para todos deja libre el horario y queda como historial (de ella cuelgan
--     las reservas canceladas). Reservar en un horario cuya clase se canceló
--     crea una clase nueva.
--   - El enum class_status pasa a llamarse booking_status: es el estado de
--     cada reserva, no de la clase.
--   - Las neuronas del alumno por asistir pasan de la clave 'class:<id>' a
--     'booking:<id>': el id siempre fue el de la reserva.
--   - Las formas de pago quedan en class_bookings, porque cada alumno de una
--     misma clase puede pagar distinto (tarifa, paquete o neuronas).
--
-- Migración de datos: las reservas se agrupan en clases por docente, fecha,
-- horario, materia y lo copiado de la ventana. Antes de mover nada se verifica
-- que las reservas no canceladas de un mismo turno coincidan en todo eso; si
-- no, la migración se corta sin cambiar nada (corre en una transacción).
--
-- Idempotente. Correr a mano, después de la 021:
--   psql "$DATABASE_URL" -f migrations/023_class_bookings.sql
-- (No hay 022 en esta rama: la 022_waitingList de la rama 'entrega' se
-- descartó.)

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.class_bookings') IS NOT NULL THEN
    RETURN; -- ya se corrió
  END IF;

  -- 1. Verificación: un turno en pie (docente, fecha, inicio) tiene que ser
  --    una sola clase, con los mismos datos en todas sus reservas.
  IF EXISTS (
    SELECT 1 FROM classes
    WHERE status <> 'cancelada'
    GROUP BY teacher_id, class_date, start_time
    HAVING count(DISTINCT (subject_id, end_time, modality, max_students,
                           COALESCE(meeting_url, ''), COALESCE(address, ''),
                           COALESCE(locality, ''))) > 1
  ) THEN
    RAISE EXCEPTION 'Hay turnos con reservas que no coinciden (materia, horario, modalidad, cupo, link o dirección). Corregilos antes de correr la 023.';
  END IF;

  -- 2. La tabla vieja pasa a ser class_bookings. Sus restricciones e índices
  --    se llaman classes_*: se renombran para que la classes nueva pueda usar
  --    esos nombres.
  ALTER TABLE classes RENAME TO class_bookings;
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.class_bookings'::regclass AND conname LIKE 'classes\_%'
  LOOP
    EXECUTE format('ALTER TABLE class_bookings RENAME CONSTRAINT %I TO %I',
                   r.conname, 'class_bookings_' || substr(r.conname, 9));
  END LOOP;
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'class_bookings'
      AND indexname LIKE 'classes\_%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
                   r.indexname, 'class_bookings_' || substr(r.indexname, 9));
  END LOOP;

  -- 3. La tabla de clases.
  CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    class_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    -- La ventana desde la que se reservó la primera vez (NULL si se borró).
    availability_id UUID REFERENCES availability(id) ON DELETE SET NULL,
    -- Copiado de la ventana al reservar: editar la ventana no mueve la clase.
    modality class_modality NOT NULL,
    max_students INT NOT NULL,
    meeting_url TEXT,
    address TEXT,
    locality TEXT,
    -- Tiene alguna reserva no cancelada (trigger class_bookings_sync_active).
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT classes_half_hour_aligned CHECK (
      EXTRACT(MINUTE FROM start_time) IN (0, 30) AND EXTRACT(SECOND FROM start_time) = 0
    ),
    CONSTRAINT classes_duration_valid CHECK (
      end_time - start_time >= interval '30 minutes'
      AND EXTRACT(SECOND FROM end_time) = 0
      AND EXTRACT(MINUTE FROM end_time)::int % 5 = 0
    ),
    -- Destino de la FK compuesta de class_bookings.
    CONSTRAINT classes_id_schedule_key UNIQUE (id, class_date, start_time, end_time)
  );
  CREATE INDEX classes_teacher_date_idx ON classes (teacher_id, class_date);

  -- 4. Una clase por grupo de reservas con los mismos datos. Las canceladas
  --    iguales a la clase en pie de su turno quedan en ella; las que difieren
  --    forman clases inactivas (historial).
  INSERT INTO classes (teacher_id, subject_id, class_date, start_time, end_time,
                       availability_id, modality, max_students, meeting_url, address,
                       locality, active, created_at)
  SELECT teacher_id, subject_id, class_date, start_time, end_time,
         (array_agg(availability_id ORDER BY created_at))[1],
         modality, max_students, meeting_url, address, locality,
         bool_or(status <> 'cancelada'), min(created_at)
  FROM class_bookings
  GROUP BY teacher_id, subject_id, class_date, start_time, end_time,
           modality, max_students, meeting_url, address, locality;

  ALTER TABLE class_bookings ADD COLUMN class_id UUID;
  UPDATE class_bookings b SET class_id = c.id
  FROM classes c
  WHERE c.teacher_id = b.teacher_id AND c.subject_id = b.subject_id
    AND c.class_date = b.class_date AND c.start_time = b.start_time
    AND c.end_time = b.end_time AND c.modality = b.modality
    AND c.max_students = b.max_students
    AND c.meeting_url IS NOT DISTINCT FROM b.meeting_url
    AND c.address IS NOT DISTINCT FROM b.address
    AND c.locality IS NOT DISTINCT FROM b.locality;
  ALTER TABLE class_bookings ALTER COLUMN class_id SET NOT NULL;

  -- 5. Lo que ahora es de la clase sale de la reserva. Con teacher_id se van
  --    también class_bookings_teacher_no_overlap, _teacher_date_idx y
  --    _teacher_is_not_student (el rol ya separa docentes de alumnos).
  ALTER TABLE class_bookings
    DROP COLUMN teacher_id,
    DROP COLUMN subject_id,
    DROP COLUMN availability_id,
    DROP COLUMN modality,
    DROP COLUMN max_students,
    DROP COLUMN meeting_url,
    DROP COLUMN address,
    DROP COLUMN locality,
    -- Los chequea classes; la FK compuesta garantiza que son los mismos.
    DROP CONSTRAINT class_bookings_half_hour_aligned,
    DROP CONSTRAINT class_bookings_duration_valid;

  ALTER TABLE class_bookings
    ADD CONSTRAINT class_bookings_class_fkey
      FOREIGN KEY (class_id, class_date, start_time, end_time)
      REFERENCES classes (id, class_date, start_time, end_time)
      ON UPDATE CASCADE ON DELETE CASCADE;
  CREATE INDEX class_bookings_class_idx ON class_bookings (class_id);

  -- 6. Un docente no da dos clases a la vez. Ya no hace falta la excepción de
  --    "mismo inicio" que tenía la tabla vieja: una grupal es una sola fila.
  ALTER TABLE classes ADD CONSTRAINT classes_teacher_no_overlap
    EXCLUDE USING gist (
      teacher_id WITH =,
      class_date WITH =,
      timerange(start_time, end_time, '[)') WITH &&
    ) WHERE (active);
END $$;

-- 7. classes.active al día con sus reservas.
CREATE OR REPLACE FUNCTION class_bookings_sync_active() RETURNS trigger AS $$
DECLARE
  target UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.class_id ELSE NEW.class_id END;
BEGIN
  UPDATE classes c
  SET active = EXISTS (
    SELECT 1 FROM class_bookings b WHERE b.class_id = c.id AND b.status <> 'cancelada'
  )
  WHERE c.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS class_bookings_sync_active ON class_bookings;
CREATE TRIGGER class_bookings_sync_active
  AFTER INSERT OR DELETE OR UPDATE OF status ON class_bookings
  FOR EACH ROW EXECUTE FUNCTION class_bookings_sync_active();

-- 8. Nombres de reserva para lo que es de la reserva.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'class_status') THEN
    ALTER TYPE class_status RENAME TO booking_status;
  END IF;
END $$;

UPDATE neurona_credits
SET source_key = 'booking:' || substr(source_key, length('class:') + 1)
WHERE source_key LIKE 'class:%';

COMMIT;
