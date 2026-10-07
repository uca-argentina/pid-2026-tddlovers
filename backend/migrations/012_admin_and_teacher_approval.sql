-- Rol administrador y aprobación de docentes.
--
--   - Hay un tercer rol, 'admin'. No se elige al registrarse (el registro
--     solo acepta teacher/student): se crea con `npm run create-admin`.
--   - Todo docente nuevo nace PENDIENTE de aprobación. Mientras está
--     pendiente o rechazado puede editar su perfil y cargar disponibilidad,
--     pero no aparece en las búsquedas ni recibe reservas. Un admin lo
--     aprueba o lo rechaza; si un rechazado edita su perfil, vuelve a
--     pendiente (lo vuelve a mandar a revisión).
--
-- Las reglas de qué se puede hacer en cada estado viven en
-- src/lib/teacherApproval.js; acá solo se guarda el estado.
--
-- Los valores van en inglés, como el rol y la modalidad: viajan por la API y
-- el front los traduce ("Pendiente", "Aprobado", "Rechazado") al mostrarlos.
--
-- Idempotente. Correr a mano:
--   psql "$DATABASE_URL" -f migrations/012_admin_and_teacher_approval.sql

-- ADD VALUE no puede usarse en la misma transacción en que se agrega; psql -f
-- corre cada sentencia por separado (autocommit), así que no hay problema.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';

DO $$ BEGIN
  CREATE TYPE teacher_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status teacher_approval_status,
  -- Quién y cuándo tomó la última decisión, para poder rastrearla.
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Los docentes que ya existían se aprueban: ya estaban publicados y con
-- reservas, y esconderlos de golpe dejaría a sus alumnos sin poder volver a
-- reservarles hasta que un admin los revise.
UPDATE users SET approval_status = 'approved'
WHERE role = 'teacher' AND approval_status IS NULL;

-- Solo los docentes tienen estado de aprobación, y todos tienen uno: así
-- "docente sin estado" o "alumno aprobado" no pueden existir.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_only_teachers;
ALTER TABLE users ADD CONSTRAINT users_approval_only_teachers CHECK (
  (role = 'teacher') = (approval_status IS NOT NULL)
);

-- La pantalla del admin lista por estado (lo primero que mira son los
-- pendientes).
CREATE INDEX IF NOT EXISTS users_approval_status_idx
  ON users (approval_status) WHERE approval_status IS NOT NULL;
