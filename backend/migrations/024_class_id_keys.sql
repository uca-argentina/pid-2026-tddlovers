-- Lo que colgaba de un "turno" (docente, fecha, inicio) pasa a colgar de la
-- clase (classes.id, de la 023):
--
--   - class_materials y class_material_files: el material es de la clase.
--     Las storage_key ya guardadas no cambian (los objetos del bucket no se
--     mueven); las nuevas son 'materials/<classId>/<id>'.
--   - homeworks: una tarea a una grupal apunta a la clase (class_id). Materia,
--     fecha y horario salen de ahí; subject_id, class_date y start_time se van.
--   - neurona_credits: lo que gana el docente por dar una clase pasa de la
--     clave 'turn:<fecha>:<HH:MM>' a 'taught:<classId>'.
--
-- Un turno puede tener varias clases (una en pie y otras canceladas para
-- todos); se elige la que pudo darse (alguna reserva aceptada, confirmada,
-- realizada o no_presentada), después la activa, después la más nueva. Si algo
-- no encuentra clase, la migración se corta sin cambiar nada.
--
-- Idempotente. Correr a mano, después de la 023:
--   psql "$DATABASE_URL" -f migrations/024_class_id_keys.sql

BEGIN;

-- La clase de ese docente, fecha e inicio, con el criterio de arriba. Solo
-- para esta migración.
CREATE OR REPLACE FUNCTION pg_temp.class_at(teacher UUID, d DATE, t TIME)
RETURNS UUID AS $$
  SELECT c.id FROM classes c
  WHERE c.teacher_id = teacher AND c.class_date = d AND c.start_time = t
  ORDER BY EXISTS (
             SELECT 1 FROM class_bookings b
             WHERE b.class_id = c.id
               AND b.status IN ('aceptada', 'confirmada', 'realizada', 'no_presentada')
           ) DESC,
           c.active DESC,
           c.created_at DESC
  LIMIT 1
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  -- 1. Material.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'class_materials' AND column_name = 'class_id'
  ) THEN
    ALTER TABLE class_materials ADD COLUMN class_id UUID;
    UPDATE class_materials SET class_id = pg_temp.class_at(teacher_id, class_date, start_time);
    IF EXISTS (SELECT 1 FROM class_materials WHERE class_id IS NULL) THEN
      RAISE EXCEPTION 'Hay material de un turno sin clase. Revisalo antes de correr la 024.';
    END IF;

    ALTER TABLE class_material_files ADD COLUMN class_id UUID;
    UPDATE class_material_files f SET class_id = m.class_id
    FROM class_materials m
    WHERE m.teacher_id = f.teacher_id AND m.class_date = f.class_date
      AND m.start_time = f.start_time;
    IF EXISTS (SELECT 1 FROM class_material_files WHERE class_id IS NULL) THEN
      RAISE EXCEPTION 'Hay archivos sin material. Revisalos antes de correr la 024.';
    END IF;

    -- La FK vieja de archivos a material era por turno: se va con las columnas.
    ALTER TABLE class_material_files
      DROP COLUMN teacher_id, DROP COLUMN class_date, DROP COLUMN start_time;
    ALTER TABLE class_materials
      DROP CONSTRAINT class_materials_pkey,
      DROP COLUMN teacher_id, DROP COLUMN class_date, DROP COLUMN start_time;

    ALTER TABLE class_materials
      ALTER COLUMN class_id SET NOT NULL,
      ADD CONSTRAINT class_materials_pkey PRIMARY KEY (class_id),
      ADD CONSTRAINT class_materials_class_fkey
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
    ALTER TABLE class_material_files
      ALTER COLUMN class_id SET NOT NULL,
      ADD CONSTRAINT class_material_files_material_fkey
        FOREIGN KEY (class_id) REFERENCES class_materials(class_id) ON DELETE CASCADE;
    CREATE INDEX class_material_files_class_idx ON class_material_files (class_id);
  END IF;

  -- 2. Tareas a una grupal.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'homeworks' AND column_name = 'class_id'
  ) THEN
    -- SET NULL: una clase solo se borra con su docente, y ahí la tarea
    -- también se va (homeworks.teacher_id es ON DELETE CASCADE).
    ALTER TABLE homeworks ADD COLUMN class_id UUID REFERENCES classes(id) ON DELETE SET NULL;
    UPDATE homeworks SET class_id = pg_temp.class_at(teacher_id, class_date, start_time)
    WHERE class_date IS NOT NULL;
    IF EXISTS (SELECT 1 FROM homeworks WHERE class_date IS NOT NULL AND class_id IS NULL) THEN
      RAISE EXCEPTION 'Hay tareas de una grupal sin clase. Revisalas antes de correr la 024.';
    END IF;
    -- subject_id solo se cargaba en las de grupal: la materia es la de la clase.
    ALTER TABLE homeworks
      DROP CONSTRAINT IF EXISTS homeworks_class_complete,
      DROP COLUMN subject_id, DROP COLUMN class_date, DROP COLUMN start_time;
    CREATE INDEX homeworks_class_idx ON homeworks (class_id) WHERE class_id IS NOT NULL;
  END IF;

  -- 3. Neuronas del docente por dar una clase.
  UPDATE neurona_credits n
  SET source_key = 'taught:' || pg_temp.class_at(
    n.user_id,
    split_part(n.source_key, ':', 2)::date,
    (split_part(n.source_key, ':', 3) || ':' || split_part(n.source_key, ':', 4))::time
  )
  WHERE n.reason = 'class_taught' AND n.source_key LIKE 'turn:%';
  IF EXISTS (
    SELECT 1 FROM neurona_credits
    WHERE reason = 'class_taught' AND (source_key LIKE 'turn:%' OR source_key = 'taught:')
  ) OR EXISTS (
    SELECT 1 FROM neurona_credits WHERE reason = 'class_taught' AND source_key IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay neuronas de clases dadas sin clase. Revisalas antes de correr la 024.';
  END IF;
END $$;

COMMIT;
