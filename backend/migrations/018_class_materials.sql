-- Material de una clase ya dada: un resumen y archivos adjuntos que el
-- docente carga después de la clase y que ven los alumnos anotados.
--
--   - La clave es el TURNO (docente, fecha, inicio) y no la fila de classes:
--     una grupal son varias filas, una por alumno, y el material es uno solo
--     para todos. La restricción de exclusión de classes ya garantiza que dos
--     clases no canceladas del docente con el mismo inicio son la misma.
--   - Los archivos NO van en la base (Neon free tiene 0,5 GB) ni en el disco
--     de Render (se borra en cada deploy): van a un bucket S3 — Backblaze B2
--     en producción, MinIO en local — y acá queda solo su clave
--     (storage_key). Nombre, tipo y tamaño se guardan acá para listar y
--     controlar los topes (lib/classMaterials.js) sin preguntarle al bucket.
--   - Quién puede ver o cargar, y desde cuándo, lo decide la ruta: depende de
--     la hora y del estado de cada reserva.
--
-- Idempotente. Correr a mano, después de la 017:
--   psql "$DATABASE_URL" -f migrations/018_class_materials.sql

CREATE TABLE IF NOT EXISTS class_materials (
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_date DATE NOT NULL,
  start_time TIME NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (teacher_id, class_date, start_time),
  CONSTRAINT class_materials_summary_length CHECK (char_length(summary) <= 5000)
);

CREATE TABLE IF NOT EXISTS class_material_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL,
  class_date DATE NOT NULL,
  start_time TIME NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  -- Dónde está el archivo en el bucket (backend/src/storage/files.js).
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (teacher_id, class_date, start_time)
    REFERENCES class_materials (teacher_id, class_date, start_time) ON DELETE CASCADE,
  CONSTRAINT class_material_files_name_valid
    CHECK (char_length(filename) BETWEEN 1 AND 255),
  CONSTRAINT class_material_files_size_valid CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS class_material_files_turn_idx
  ON class_material_files (teacher_id, class_date, start_time);
