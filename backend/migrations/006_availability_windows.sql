-- Cambio de requerimiento: la disponibilidad deja de ser una plantilla
-- semanal sin materia y pasa a ser una lista de VENTANAS con todo lo que el
-- docente decide sobre esa clase:
--   - una fecha concreta, y opcionalmente "se repite todas las semanas" desde
--     esa fecha (cada semana puede ser distinta),
--   - la materia (ya no la elige el alumno al reservar),
--   - cuánto dura cada clase (mínimo 30 min, de a media hora),
--   - modalidad: virtual, presencial o híbrida, con su link y/o dirección,
--   - cupo: 1 es individual, más de 1 es grupal.
--
-- Las ventanas viejas se descartan (mismo criterio que 005): no tienen
-- materia ni modalidad, y no hay de dónde inventarlas. Cada docente vuelve a
-- cargar su disponibilidad.
--
-- Idempotente: el DELETE solo corre mientras falta la columna nueva.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/006_availability_windows.sql

-- Valores en inglés/ASCII: viajan por la API. "Presencial" y compañía son
-- texto de pantalla y los arma el front.
DO $$ BEGIN
  CREATE TYPE class_modality AS ENUM ('virtual', 'in_person', 'hybrid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- --- availability -----------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'availability' AND column_name = 'start_date'
  ) THEN
    DELETE FROM availability;
  END IF;
END $$;

-- El día de la semana ya no se guarda: sale de la fecha. Guardarlo aparte
-- sería una segunda verdad que se puede desincronizar.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_no_overlap;
ALTER TABLE availability DROP COLUMN IF EXISTS day_key;

ALTER TABLE availability
  -- La fecha de la ventana o, si se repite, la de la primera vez.
  ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL,
  ADD COLUMN IF NOT EXISTS repeats_weekly BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL,
  ADD COLUMN IF NOT EXISTS modality class_modality NOT NULL,
  ADD COLUMN IF NOT EXISTS max_students INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS meeting_url TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Antes una ventana tenía que durar al menos 1 h porque las clases duraban
-- 1 h. Ahora la regla es "entra al menos una clase", y eso depende de la
-- duración que eligió el docente.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_fits_one_class;

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_duration_valid;
ALTER TABLE availability ADD CONSTRAINT availability_duration_valid CHECK (
  duration_minutes >= 30
  AND duration_minutes % 30 = 0
  AND make_interval(mins => duration_minutes) <= end_time - start_time
);

-- 50 es un techo de sentido común, no del negocio: evita que un typo
-- (500) publique una clase imposible.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_capacity_valid;
ALTER TABLE availability ADD CONSTRAINT availability_capacity_valid CHECK (
  max_students BETWEEN 1 AND 50
);

-- Virtual necesita link, presencial dirección, híbrida las dos.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_location_valid;
ALTER TABLE availability ADD CONSTRAINT availability_location_valid CHECK (
  (modality = 'in_person' OR meeting_url IS NOT NULL)
  AND (modality = 'virtual' OR address IS NOT NULL)
);

-- Que dos ventanas no se pisen NO va como restricción de exclusión: con la
-- repetición semanal, una ventana del 14/9 choca con una semanal de los
-- lunes que arrancó el 7/9, y eso no se expresa con un && de rangos. Lo
-- valida db/availability.js adentro de una transacción con lock por docente.

DROP INDEX IF EXISTS availability_teacher_idx;
CREATE INDEX IF NOT EXISTS availability_teacher_date_idx ON availability (teacher_id, start_date);

-- --- classes ----------------------------------------------------------------

-- La clase dura lo que diga la ventana, no 1 h fija. Sigue terminando en
-- :00 o :30.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_one_hour;
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_duration_valid;
ALTER TABLE classes ADD CONSTRAINT classes_duration_valid CHECK (
  end_time - start_time >= INTERVAL '30 minutes'
  AND EXTRACT(MINUTE FROM end_time) IN (0, 30)
  AND EXTRACT(SECOND FROM end_time) = 0
);

-- Lo que el alumno necesita saber de la clase que reservó, copiado de la
-- ventana en el momento de reservar: si después el docente borra o cambia la
-- ventana, la clase ya tomada no se queda sin dirección. Nulos en las clases
-- viejas, que son de antes de que existieran.
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS availability_id UUID REFERENCES availability(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modality class_modality,
  ADD COLUMN IF NOT EXISTS max_students INTEGER,
  ADD COLUMN IF NOT EXISTS meeting_url TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Clases grupales: varios alumnos en el MISMO turno del docente son varias
-- filas con el mismo docente, fecha e inicio. La restricción vieja las
-- rechazaba por pisarse; ahora solo se rechaza lo que se pisa arrancando a
-- OTRA hora (14:00 y 14:30), que sí sería el docente dando dos clases a la
-- vez. `<>` sobre time lo da btree_gist.
--
-- El cupo no se puede escribir acá (una exclusión no cuenta filas): lo
-- controla la ruta de reservas con un lock por docente y fecha.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_teacher_no_overlap;
ALTER TABLE classes ADD CONSTRAINT classes_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    class_date WITH =,
    timerange(start_time, end_time, '[)') WITH &&,
    start_time WITH <>
  ) WHERE (status = 'reservada');
