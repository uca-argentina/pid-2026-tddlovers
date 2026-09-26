-- Cambio de requerimiento: el precio deja de ser de la ventana y pasa a ser
-- del docente.
--
--   - En su perfil, el docente pone una TARIFA POR HORA para cada combinación
--     de materia y modalidad ("Matemática virtual, $ 5.000/h"). Sin tarifa
--     para una combinación = no da esa materia en esa modalidad.
--   - La ventana ya no dice materia, duración ni precio: solo cuándo, en qué
--     modalidad (con su link/localidad/dirección) y si acepta grupales.
--   - El alumno, al reservar, elige la materia (entre las que el docente
--     tiene tarifa en esa modalidad), la hora de inicio y la duración (de a
--     5 min, mínimo 30). La clase cuesta tarifa × duración, en centavos.
--
-- Los datos viejos se descartan (decisión del equipo), ventanas Y clases: las
-- clases tienen un precio calculado con el modelo viejo, y ninguna ventana
-- tiene de dónde sacar una tarifa. Cada docente carga tarifas y vuelve a
-- cargar su disponibilidad.
--
-- Idempotente: los DELETE solo corren mientras la columna vieja existe.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/009_teacher_rates.sql

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'availability' AND column_name = 'subject_id'
  ) THEN
    DELETE FROM classes;
    DELETE FROM availability;
  END IF;
END $$;

-- --- teacher_rates ----------------------------------------------------------

-- En centavos: el docente puede cobrar $ 5.000,50 la hora, y una clase de
-- 50 min de $ 5.000/h sale $ 4.166,67. Enteros y no NUMERIC para que pg no
-- los devuelva como string y la cuenta sea exacta.
--
-- La FK va contra teacher_subjects y no contra subjects: si el docente saca
-- una materia del perfil, sus tarifas se van con ella y nunca queda una
-- tarifa de una materia que no da.
CREATE TABLE IF NOT EXISTS teacher_rates (
  teacher_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  modality class_modality NOT NULL,
  hourly_rate_cents INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, subject_id, modality),
  FOREIGN KEY (teacher_id, subject_id)
    REFERENCES teacher_subjects (teacher_id, subject_id) ON DELETE CASCADE,
  -- 0 es sin cargo. El techo ($ 10.000.000/h) es de sentido común: frena un
  -- typo con ceros de más.
  CONSTRAINT teacher_rates_amount_valid CHECK (hourly_rate_cents BETWEEN 0 AND 1000000000)
);

-- --- availability -----------------------------------------------------------

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_duration_valid;
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_price_valid;
ALTER TABLE availability DROP COLUMN IF EXISTS subject_id;
ALTER TABLE availability DROP COLUMN IF EXISTS duration_minutes;
ALTER TABLE availability DROP COLUMN IF EXISTS price;

-- Antes la regla era "entra al menos una clase de la duración elegida". La
-- duración ahora la elige el alumno, con un mínimo de 30 min: la ventana
-- tiene que tener lugar para esa.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_fits_one_class;
ALTER TABLE availability ADD CONSTRAINT availability_fits_one_class CHECK (
  end_time - start_time >= INTERVAL '30 minutes'
);

-- Con la tabla vacía ya no hay filas viejas sin localidad: el CHECK de 008
-- se puede validar entero.
ALTER TABLE availability VALIDATE CONSTRAINT availability_locality_valid;

-- --- classes ----------------------------------------------------------------

-- Lo que pagó el alumno, calculado al reservar (tarifa × duración) y copiado
-- como el resto: si el docente cambia la tarifa, lo reservado no se mueve.
ALTER TABLE classes DROP COLUMN IF EXISTS price;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS price_cents INTEGER;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_price_valid;
ALTER TABLE classes ADD CONSTRAINT classes_price_valid CHECK (price_cents >= 0);

-- Eran nulables por las clases de antes de 006/007/008. Ya no queda ninguna.
ALTER TABLE classes
  ALTER COLUMN modality SET NOT NULL,
  ALTER COLUMN max_students SET NOT NULL,
  ALTER COLUMN price_cents SET NOT NULL;

-- La duración la elige el alumno de a 5 minutos. Arranca en :00/:30
-- (classes_half_hour_aligned, de 004), así que el fin cae en múltiplo de 5.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_duration_valid;
ALTER TABLE classes ADD CONSTRAINT classes_duration_valid CHECK (
  end_time - start_time >= INTERVAL '30 minutes'
  AND EXTRACT(SECOND FROM end_time) = 0
  AND EXTRACT(MINUTE FROM end_time)::int % 5 = 0
);
